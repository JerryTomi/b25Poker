import asyncio
from database import SessionLocal, engine
import models
from main import create_demo_session, DemoSessionRequest

models.Base.metadata.create_all(bind=engine)

async def run():
    try:
        req = DemoSessionRequest(display_name="Tomi")
        res = await create_demo_session(req)
        print(res)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(run())
