# backend/blockchain.py
import logging
import os

from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

logger = logging.getLogger("poker.blockchain")

RPC_URL = os.getenv("BASE_SEPOLIA_RPC", "")
PRIVATE_KEY = os.getenv("SERVER_PRIVATE_KEY", "")
CONTRACT_ADDRESS = os.getenv("ESCROW_CONTRACT_ADDRESS", "")
CHAIN_ID = int(os.getenv("CHAIN_ID", "84532"))

w3 = Web3(Web3.HTTPProvider(RPC_URL)) if RPC_URL else None

# ✅ Updated ABI to match your new 5-argument contract
ESCROW_ABI = [
    {
        "inputs": [
            {"internalType": "string", "name": "_id",          "type": "string"},
            {"internalType": "string", "name": "_title",       "type": "string"},
            {"internalType": "string", "name": "_desc",        "type": "string"},
            {"internalType": "uint256","name": "_buyIn",       "type": "uint256"},
            {"internalType": "address","name": "_requiredNft", "type": "address"},
        ],
        "name": "createTournament",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "string",  "name": "tableId", "type": "string"},
            {"internalType": "address", "name": "winner",  "type": "address"},
        ],
        "name": "awardWinner",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


def _contract():
    if not (w3 and PRIVATE_KEY and CONTRACT_ADDRESS):
        return None, None
    account = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=ESCROW_ABI
    )
    return account, contract


def _send_transaction(builder):
    account, contract = _contract()
    if not account or not contract:
        logger.warning("Blockchain credentials missing. Skipping on-chain action.")
        return False
    try:
        nonce = w3.eth.get_transaction_count(account.address)
        tx = builder(contract).build_transaction({
            "chainId": CHAIN_ID,
            "gas": 400000,
            "gasPrice": w3.eth.gas_price,
            "nonce": nonce,
        })
        signed = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        logger.info("TX submitted: %s", w3.to_hex(tx_hash))
        return True
    except Exception as exc:
        logger.exception("Blockchain TX failed: %s", exc)
        return False


def create_tournament(
    table_id: str,
    title: str,
    desc: str,
    buy_in_usdc: int,          # whole number, e.g. 25
    required_nft: str | None,
):
    nft_address = required_nft or "0x0000000000000000000000000000000000000000"
    checksum_nft = Web3.to_checksum_address(nft_address)
    return _send_transaction(
        lambda c: c.functions.createTournament(
            table_id, title, desc, buy_in_usdc, checksum_nft
        )
    )


def payout_winner(table_id: str, winner_address: str):
    checksum_winner = Web3.to_checksum_address(winner_address)
    return _send_transaction(
        lambda c: c.functions.awardWinner(table_id, checksum_winner)
    )