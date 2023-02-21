const hre = require("hardhat");
const ethers = hre.ethers;

async function getHashedSecret(secretMessage, secretHandler) {
    const salt = ethers.utils.randomBytes(32);
    const saltHexValue = ethers.utils.hexlify(salt);
    const hashedSecret = await secretHandler.connect(rando).hashSecret(secretMessage, saltHexValue);
    
    return {
        hashedSecret: hashedSecret,
        salt: saltHexValue
    }
}

async function prepareSplitSignature(
    id,
    hashedSecret,
    blockNumber,
    party1,
    party2,
    verifyingContract,
    signer
) {
    const chainId = (await ethers.provider.getNetwork()).chainId;

    domain = {
      name: 'SecretHandler',
      version: '1',
      chainId: chainId,
      verifyingContract: verifyingContract.address
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
        blockNumber: blockNumber,
        party1: party1.address,
        party2: party2.address
    }

    signature = await signer._signTypedData(domain, types, value);
    splitSignature = ethers.utils.splitSignature(signature);

    return splitSignature;
}

function getEvent(receipt, factory, eventName) {
    let found = false;
  
    const eventFragment = factory.interface.fragments.filter((e) => e.name == eventName);
    const iface = new ethers.utils.Interface(eventFragment);
  
    for (const log in receipt.logs) {
      const topics = receipt.logs[log].topics;
  
      for (const index in topics) {
        const encodedTopic = topics[index];
  
        try {
          // CHECK IF TOPIC CORRESPONDS TO THE EVENT GIVEN TO FN
          const event = iface.getEvent(encodedTopic);
  
          if (event.name == eventName) {
            found = true;
            const eventArgs = iface.parseLog(receipt.logs[log]).args;
            return eventArgs;
          }
        } catch (e) {
          if (e.message.includes("no matching event")) continue;
          console.log("event error: ", e);
          throw new Error(e);
        }
      }
    }
  
    if (!found) {
      throw new Error(`Event with name ${eventName} was not emitted!`);
    }
  }

exports.prepareSplitSignature = prepareSplitSignature;
exports.getHashedSecret = getHashedSecret;
exports.getEvent = getEvent;



