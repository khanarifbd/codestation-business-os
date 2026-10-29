import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "e2e-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";

test("user can enroll a passkey and sign in passwordlessly", async ({ page, context }) => {
  const passkeyName = `CI virtual passkey ${Date.now()}`;
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  try {
    await page.goto("/login");
    await page.getByLabel(/email or username/i).fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /sign in securely/i }).click();
    await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });

    await page.goto("/dashboard/profile", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /^Sign-in & security/ }).click();
    await page.getByRole("link", { name: /^Passkeys/ }).click();
    await expect(page.getByRole("heading", { name: "Your passkeys", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Add a passkey", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add a passkey", exact: true })).toBeVisible();

    await page.getByLabel("Passkey name").fill(passkeyName);
    await page.locator('input[name="passkey_current_password"]').fill(password);
    await page.getByRole("button", { name: "Verify & add passkey" }).click();

    // Surface WebAuthn browser failures in the CI log instead of reporting only
    // a generic timeout when navigator.credentials.create() rejects.
    await expect.poll(async () => {
      if (await page.getByText("Passkey registered for your global account.").isVisible()) {
        return "success";
      }
      const alert = page.getByRole("alert").first();
      if (await alert.isVisible()) return `browser error: ${await alert.innerText()}`;
      return "pending";
    }, { timeout: 15_000 }).toBe("success");
    await page.getByRole("button", { name: "Back to account settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your passkeys", exact: true })).toBeVisible();
    await expect(page.getByText(passkeyName, { exact: true })).toBeVisible();

    // Clear only browser cookies to prove the next authentication starts without
    // an existing Business OS access/refresh session. The virtual authenticator
    // keeps the discoverable credential exactly like a device passkey would.
    await context.clearCookies();
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/passkeys/verify" && response.request().method() === "POST");
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // Conditional WebAuthn can navigate while Playwright is actioning the
    // explicit button. Observe both legitimate paths, not a 500ms URL snapshot.
    const signedIn = page.waitForURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });
    await Promise.all([
      verified.then(response => expect(response.status()).toBe(200)),
      Promise.race([
        signedIn,
        page.getByRole("button", { name: "Sign in with a passkey" }).click().then(() => signedIn),
      ]),
    ]);
    await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
    await cdp.send("WebAuthn.disable").catch(() => undefined);
  }
});
