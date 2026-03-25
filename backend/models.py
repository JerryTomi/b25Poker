from sqlalchemy import Column, Integer, String, Float
from database import Base

class PlayerDB(Base):
    __tablename__ = "players"

    # In the future, this string will be their Web3 Wallet Address (0x123...)
    # For now, it will be the random "player_a3f9" ID
    id = Column(String, primary_key=True, index=True)
    
    # Their persistent bankroll across all games
    chip_balance = Column(Integer, default=10000)
    usdc_balance = Column(Float, default=0.0)