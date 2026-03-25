import os
from web3 import Web3
from dotenv import load_dotenv

# Load the secret variables from the .env file
load_dotenv()

RPC_URL = os.getenv("BASE_SEPOLIA_RPC")
PRIVATE_KEY = os.getenv("SERVER_PRIVATE_KEY")
CONTRACT_ADDRESS = os.getenv("ESCROW_CONTRACT_ADDRESS")

# Connect to Base Sepolia
w3 = Web3(Web3.HTTPProvider(RPC_URL))

# The ABI tells Python exactly what the awardWinner function looks like
ESCROW_ABI = [
    {
        "inputs": [
            {"internalType": "string", "name": "tableId", "type": "string"},
            {"internalType": "address", "name": "winner", "type": "address"}
        ],
        "name": "awardWinner",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]

def payout_winner(table_id: str, winner_address: str):
    """Securely signs a transaction to release the prize pool to the winner."""
    if not PRIVATE_KEY or not CONTRACT_ADDRESS:
        print("⚠️ Missing blockchain credentials in .env. Skipping payout.")
        return False
        
    try:
        # 1. Setup the Wallet and Contract
        account = w3.eth.account.from_key(PRIVATE_KEY)
        contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=ESCROW_ABI)
        
        # Ethereum requires addresses to be "checksummed" (mixed uppercase/lowercase)
        checksum_winner = w3.to_checksum_address(winner_address)
        
        print(f"⛓️ Initiating Blockchain Payout for {checksum_winner} on {table_id}...")

        # 2. Build the Transaction
        nonce = w3.eth.get_transaction_count(account.address)
        tx = contract.functions.awardWinner(table_id, checksum_winner).build_transaction({
            'chainId': 84532, # 84532 is Base Sepolia
            'gas': 200000,
            'gasPrice': w3.eth.gas_price,
            'nonce': nonce,
        })
        
        # 3. Sign it with the Server's Private Key
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
        
        # 4. Broadcast it to the Base Network
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        
        print(f"✅ Payout Successful! TX Hash: {w3.to_hex(tx_hash)}")
        return True
        
    except Exception as e:
        print(f"❌ Blockchain payout failed: {e}")
        return False