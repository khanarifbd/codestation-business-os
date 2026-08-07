from fastapi import FastAPI

app = FastAPI(
    title="CodeStation Business OS API",
    version="0.1.0",
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "codestation-business-os-api",
    }
