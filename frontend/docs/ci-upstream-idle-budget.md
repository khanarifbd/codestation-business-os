# CI upstream idle-close margin

The two disposable CI Uvicorn servers use the official `--timeout-keep-alive 60` setting. This affects only idle persistent Next-to-backend connections, not HTTP action/test deadlines, application permissions, financial behavior or retries. Production deployment configuration is unchanged.

CI2362 observed active Undici request13074 on a twice-used upstream socket, local34458 to8000: request send then UND_ERR_SOCKET within18ms. Socket age5.179s and client-observed last response4.636s are consistent with, but do not prove, default5s server idle closure; server completion precedes client observation. Backend and Next processes remained alive. Prior socket events were evicted.

Bounded separate local Uvicorn/native-fetch probes did NOT reproduce the reset: default5s reconnected successfully, longer30/60s retained the connection. Local Node24 differs from CI22. This is a targeted CI mitigation experiment, not a proven root-cause fix or live-production certification. A new actual CI run remains required; no failed request is retried.

Official setting: https://uvicorn.dev/settings/ . The tradeoff is retaining idle CI sockets longer; same disposable process cleanup ends them. Existing browser-side Connection:close is a separate hop and remains unchanged.
