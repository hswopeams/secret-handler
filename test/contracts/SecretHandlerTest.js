const {
  mine
} = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect, assert} = require("chai");
const { ethers } = require("hardhat");
const {keccak256, solidityPack, solidityKeccak256} = ethers.utils;
const BigNumber = ethers.BigNumber;
const crypto = require('crypto');
const { RevertReasons } = require("../util/revert-reasons.js");
const { prepareSplitSignature, getHashedSecret, getEvent } = require("../util/utils.js");
const Secret = require("../../scripts/domain/Secret");

describe("SecretHandler", function () {
   // Suite-wide scope
   let secret, object, promoted, clone, dehydrated, rehydrated, key, secretStruct;
   let id, message, party1, party2, blockNumber;
   let secretHandler;
   let nextSecretId, emittedSecretId, salt, hashedSecret, secretBytes32, chainId;
   let domain, types, value;
   let signature, splitSignature, r, s, v;

  //before each test case in the suite
  beforeEach(async function () {
    // Get signers
    [owner, party1, party2, rando] = await ethers.getSigners();

    nextSecretId = "1";

    // Deploy contract
    const SecretHandler = await ethers.getContractFactory("SecretHandler");
    secretHandler = await SecretHandler.deploy();
  })

  describe("Deployment", function () {
    it("should set the right Id", async function () {
      expect(await secretHandler.connect(rando).nextSecretId()).to.equal(nextSecretId);
    });

  });

  describe("hashSecret()", function () {
    context("Revert", function () {
      it("should revert with the right error if salt is invalid", async function () {
        secretBytes32 = ethers.utils.formatBytes32String("this is the secret");
        salt = ethers.utils.hexZeroPad("0x", 32)
       
        await expect(secretHandler.connect(rando).hashSecret(secretBytes32, salt)).to.be.revertedWith(
          RevertReasons.INVALID_SALT
        );
      });

      it("should revert with the right error if plain secret invalid", async function () {
        secretBytes32 = ethers.utils.hexZeroPad("0x", 32)
        salt = ethers.utils.randomBytes(32);
       
        await expect(secretHandler.connect(rando).hashSecret(secretBytes32, salt)).to.be.revertedWith(
          RevertReasons.INVALID_SECRET
        );
      });


    });

    context("Generate valid hash", function () {
      it("should correctly generate a hash", async function () {
        secretBytes32 = ethers.utils.formatBytes32String("this is the secret");
        salt = ethers.utils.randomBytes(32);
        const saltHexValue = ethers.utils.hexlify(salt);
      
        hashedsecret = await secretHandler.connect(rando).hashSecret(secretBytes32, saltHexValue);
        expect(hashedsecret).to.not.equal(ethers.constants.HashZero);
      });
    });
  });

  describe("commitSecret() ", function () {
    beforeEach(async function () {
        secretBytes32 = ethers.utils.formatBytes32String("this is the secret");
        ({hashedSecret, salt} = await getHashedSecret(secretBytes32, secretHandler));
        id = await secretHandler.nextSecretId(); 

        //Set blockNumber to 0 now. The actual blocknumber will be retrieved from the event
        splitSignature = await prepareSplitSignature(
          id,
          hashedSecret,
          ethers.constants.Zero,
          party1,
          party2,
          secretHandler,
          party2
        )

        // Create a valid secret object, then set fields in tests directly
        secret = new Secret(id.toString(),  hashedSecret, "0", party1.address, party2.address);
        expect(secret.isValid()).is.true;
      
        // Get secret as struct
        const secretStruct = secret.toStruct();

    })
    describe("Reverts", function () {
      it("should revert with the right error if party2 address is invalid", async function () {
        await expect(
          secretHandler.connect(party1).commitSecret(
            hashedSecret, 
            ethers.constants.AddressZero, 
            splitSignature.r, 
            splitSignature.s, 
            splitSignature.v)
          ).to.be.revertedWith(
            RevertReasons.INVALID_ADDRESS
          );
      });

      it("should revert with the right error if secret message is invalid", async function () {
        await expect(
          secretHandler.connect(party1).commitSecret(
            ethers.utils.hexZeroPad("0x", 32), 
            party2.address, 
            splitSignature.r, 
            splitSignature.s, 
            splitSignature.v)
          ).to.be.revertedWith(
            RevertReasons.INVALID_SECRET
          );   
      });

      it("should revert with the right error if party1 signed the transaction", async function () {
        //Sign with party1
        splitSignature = await prepareSplitSignature(
          id,
          hashedSecret,
          ethers.constants.Zero,
          party1,
          party2,
          secretHandler,
          party1
        )

        await expect(
          secretHandler.connect(party1).commitSecret(
            hashedSecret, 
            party2.address, 
            splitSignature.r, 
            splitSignature.s, 
            splitSignature.v)
          ).to.be.revertedWith(
            RevertReasons.SIGNER_AND_SIGNATURE_DO_NOT_MATCH
          );
      });

      it("should revert with the right error if a third party signed the transaction", async function () {
        //Sign with a third party signer
        splitSignature = await prepareSplitSignature(
          id,
          hashedSecret,
          ethers.constants.Zero,
          party1,
          party2,
          secretHandler,
          rando
        )

        await expect(
          secretHandler.connect(party1).commitSecret(
            hashedSecret, 
            party2.address, 
            splitSignature.r, 
            splitSignature.s, 
            splitSignature.v)
          ).to.be.revertedWith(
            RevertReasons.SIGNER_AND_SIGNATURE_DO_NOT_MATCH
          );
      });

      it("should revert with the right error if msg.sender is not part of the signed Secret struct signed by party2", async function () {
        await expect(
          secretHandler.connect(rando).commitSecret(
            hashedSecret, 
            party2.address, 
            splitSignature.r, 
            splitSignature.s, 
            splitSignature.v)
          ).to.be.revertedWith(
            RevertReasons.SIGNER_AND_SIGNATURE_DO_NOT_MATCH
          );
      });

      it("should revert with the right error if domain separator in signature is incorrect", async function () {
        domain = {
          name: 'SecretHandler',
          version: '1',
          chainId: 1, // Wrong Chain Id
          verifyingContract: secretHandler.address
        };
    
        types = {
          Secret: [
            { name: 'id', type: 'uint256' },
            { name: 'message', type: 'bytes32' },
            { name: 'blockNumber', type: 'uint256' },
            { name: 'party1', type: 'address' },
            { name: 'party2', type: 'address' }
          ]
        };

        value = {
            id: id,
            message: hashedSecret,
            blockNumber: ethers.constants.Zero,
            party1: party1.address,
            party2: party2.address
        }

        signature = await party2._signTypedData(domain, types, value);
        splitSignature = ethers.utils.splitSignature(signature);
       
        await expect(
          secretHandler.connect(party1).commitSecret(
            hashedSecret, 
            party2.address, 
            splitSignature.r, 
            splitSignature.s, 
            splitSignature.v)
          ).to.be.revertedWith(
            RevertReasons.SIGNER_AND_SIGNATURE_DO_NOT_MATCH
          );
      });

      it("should revert with the right error if recovered signer is the zero address", async function () {
        await expect(
          secretHandler.connect(party1).commitSecret(
            hashedSecret, 
            party2.address, 
            splitSignature.r, 
            splitSignature.s, 
            "0") // Invalid v signature component
          ).to.be.revertedWith(
            RevertReasons.ECDSA_INVALID_SIGNATURE
          );
      }); 
    });

    describe("Events", function () {
      it("should emit an event on commit", async function () {
        const tx = await secretHandler.connect(party1).commitSecret(hashedSecret, party2.address, splitSignature.r, splitSignature.s, splitSignature.v);

        // Set blockNumber
        secret.blockNumber = tx.blockNumber.toString();
        expect(secret.isValid()).is.true;

        // Get secret as struct
        const secretStruct = secret.toStruct();

        await expect(tx)
          .to.emit(secretHandler, "SecretCommitted")
          .withArgs(id , secretStruct, party1.address); 
    
      });
    });

    describe("State", function () {
      it("should change state correctly", async function () {
        // Check that secret is stored correctly
        const expectedSecret = secret.clone();

        const tx = await secretHandler.connect(party1).commitSecret(hashedSecret, party2.address, splitSignature.r, splitSignature.s, splitSignature.v);
        secretStruct = await secretHandler.connect(rando).secrets(id);

        // Set expected blockNumber
        expectedSecret.blockNumber = tx.blockNumber.toString();
        expect(expectedSecret.isValid()).is.true;

        // Parse into entity
        let returnedSecret = Secret.fromStruct(secretStruct);

        // Returned values should match expected
        for ([key, value] of Object.entries(expectedSecret)) {
          expect(JSON.stringify(returnedSecret[key]) === JSON.stringify(value)).is.true;
        }

        // Check that nextSecretId is incremented correctly
        expect(await secretHandler.connect(rando).nextSecretId()).to.equal(ethers.constants.Two);
      });
    });
  });
  describe("revealSecret() ", function () {
    beforeEach(async function () {
      secretBytes32 = ethers.utils.formatBytes32String("this is the secret");
      ({hashedSecret, salt} = await getHashedSecret(secretBytes32, secretHandler));
      id = await secretHandler.nextSecretId();

      //Set blockNumber to 0 now. The actual blocknumber will be retrieved from the event
      splitSignature = await prepareSplitSignature(
        id,
        hashedSecret,
        ethers.constants.Zero,
        party1,
        party2,
        secretHandler,
        party2
      )

      // Create a valid secret object, then set fields in tests directly
      secret = new Secret(id.toString(),  hashedSecret, "0", party1.address, party2.address);
      expect(secret.isValid()).is.true;

      const tx = await secretHandler.connect(party1).commitSecret(hashedSecret, party2.address, splitSignature.r, splitSignature.s, splitSignature.v);
      const txReceipt = await tx.wait();
      const event = getEvent(txReceipt, secretHandler, "SecretCommitted");
      emittedSecretId = event.secretId;

      // Make sure a block is mined because reveal should happen in a later block than commit
      await mine();
    })

    describe("Reverts", function () {
      it("should revert with the right error if secretId is invalid", async function () {
        await expect(
          secretHandler.connect(party1).revealSecret(
            secretBytes32, 
            salt, 
            BigNumber.from(10))
          ).to.be.revertedWith(
            RevertReasons.INVALID_SECRET_ID
          );
      });

      it("should revert with the right error if caller is not party to the secret", async function () {
        await expect(
          secretHandler.connect(rando).revealSecret(
            secretBytes32, 
            salt, 
            emittedSecretId)
          ).to.be.revertedWith(
            RevertReasons.CALLER_NOT_PARTY
          );
      });

      it("should revert with the right error if salt is invalid", async function () {
        await expect(
          secretHandler.connect(party1).revealSecret(
            secretBytes32, 
            ethers.utils.hexZeroPad("0x", 32), 
            emittedSecretId)
          ).to.be.revertedWith(
            RevertReasons.INVALID_SALT
          );
      });

      it("should revert with the right error if secret is invalid", async function () {
        await expect(
          secretHandler.connect(party2).revealSecret(
            ethers.utils.hexZeroPad("0x", 32), 
            salt, 
            emittedSecretId)
          ).to.be.revertedWith(
            RevertReasons.INVALID_SECRET
          );
      });

      it("should revert with the right error if revealed secret doesn't match committed secret -- different secret message", async function () {
        const differentSecretBytes32 = ethers.utils.formatBytes32String("this is not the secret");
        await expect(
          secretHandler.connect(party2).revealSecret(
            differentSecretBytes32, 
            salt, 
            emittedSecretId)
          ).to.be.revertedWith(
            RevertReasons.SECRETS_DO_NOT_MATCH
          );
      });

      it("should revert with the right error if revealed secret doesn't match committed secret -- different salt", async function () {
        const differentSalt = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        await expect(
          secretHandler.connect(party2).revealSecret(
            secretBytes32, 
            differentSalt, 
            emittedSecretId)
          ).to.be.revertedWith(
            RevertReasons.SECRETS_DO_NOT_MATCH
          );
      });

     
    });

    describe("Events", function () {
      it("should emit an event on reveal when revealed by party1", async function () {
        const tx = await secretHandler.connect(party1).revealSecret(secretBytes32, salt, emittedSecretId);
        
        await expect(tx)
          .to.emit(secretHandler, "SecretRevealed")
          .withArgs(emittedSecretId , secretBytes32, party1.address); 
      });

      it("should emit an event on reveal when revealed by party2", async function () {
        const tx = await secretHandler.connect(party2).revealSecret(secretBytes32, salt, emittedSecretId);
        
        await expect(tx)
          .to.emit(secretHandler, "SecretRevealed")
          .withArgs(emittedSecretId , secretBytes32, party2.address); 
      });
       
    });
   
    describe("State", function () {
      it("should change state correctly when called by party1", async function () {
        const tx = await secretHandler.connect(party1).revealSecret(secretBytes32, salt, emittedSecretId);
        secretStruct = await secretHandler.connect(rando).secrets(id);

        // Set expected secret to empty values
        expectedSecret = new Secret("0",  ethers.constants.HashZero, "0", ethers.constants.AddressZero, ethers.constants.AddressZero);

        // Parse into entity
        let returnedSecret = Secret.fromStruct(secretStruct);

        // Returned values should match expected
        for ([key, value] of Object.entries(expectedSecret)) {
          expect(JSON.stringify(returnedSecret[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should change state correctly when called by party2", async function () {
        const tx = await secretHandler.connect(party2).revealSecret(secretBytes32, salt, emittedSecretId);
        secretStruct = await secretHandler.connect(rando).secrets(id);

        // Set expected secret to empty values
        expectedSecret = new Secret("0",  ethers.constants.HashZero, "0", ethers.constants.AddressZero, ethers.constants.AddressZero);

        // Parse into entity
        let returnedSecret = Secret.fromStruct(secretStruct);

        // Returned values should match expected
        for ([key, value] of Object.entries(expectedSecret)) {
          expect(JSON.stringify(returnedSecret[key]) === JSON.stringify(value)).is.true;
        }
      });
    });
  });
  describe("pause() ", function () {
    describe("Reverts", function () {
      it("should revert with the right error if caller is not party to the secret", async function () {
       
      });


      it("should revert with the right error if reveal is not called at a later block", async function () {
        
      });

      it("should revert with the right error if provided party did not sign the transaction", async function () {
       
      });

     
    });

    describe("Events", function () {
      it("should emit an event on reveal", async function () {
       
      });
    });

    describe("State", function () {
      it("should change state correctly", async function () {
      
      });
    });
  });
  describe("unpause() ", function () {
    describe("Reverts", function () {
      it("should revert with the right error if caller is not party to the secret", async function () {
      
      });


      it("should revert with the right error if reveal is not called at a later block", async function () {
        
      });

      it("should revert with the right error if provided party did not sign the transaction", async function () {
       
      });

     
    });

    describe("Events", function () {
      it("should emit an event on reveal", async function () {
       
      });
    });

    describe("State", function () {
      it("should change state correctly", async function () {
      
      });
    });
  });
  describe("kill() ", function () {
    describe("Reverts", function () {
      it("should revert with the right error if caller is not party to the secret", async function () {
       
      });


      it("should revert with the right error if reveal is not called at a later block", async function () {
        
      });

      it("should revert with the right error if provided party did not sign the transaction", async function () {
       
      });

     
    });

    describe("Events", function () {
      it("should emit an event on reveal", async function () {
       
      });
    });

    describe("State", function () {
      it("should change state correctly", async function () {
      
      });
    });
  });
});
