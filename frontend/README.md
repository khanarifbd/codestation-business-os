This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### CI loopback transport scope

When `CI=true` and `E2E_BASE_URL` is HTTP on `localhost`, `127.0.0.1` or
`[::1]`, Playwright's shared context headers include `Connection: close` from
the first request, alongside the unchanged exact `Origin`. This applies to
**both browser and APIRequestContext HTTP/1 fixture traffic**, not only API GETs.
CI2358 recorded a failed reused API socket after 6.008 seconds idle at the
Node22 server's default keep-alive boundary. Fresh fixture connections avoid
recycling that idle socket; they do not retry a failed request or financial
write. Test retries and all per-action timeouts remain unchanged.

This bounded CI configuration does **not** test production keep-alive behavior,
prove all historical resets share one cause, or certify live deployment
transport. Non-CI runs, HTTPS and non-loopback targets retain the original
headers. No production server or application transport setting is changed.
The local HTTP regression proves empty idle pools/fresh GET and POST sockets
and that an actual reset still rejects once; it is not a reproduction of the
exact Node22/Playwright/Next race (the local executor uses Node24).

Supported APIs: [Playwright context headers](https://playwright.dev/docs/test-use-options#network-options)
and [Node HTTP keep-alive timeout buffer](https://nodejs.org/api/http.html#serverkeepalivetimeoutbuffer).
