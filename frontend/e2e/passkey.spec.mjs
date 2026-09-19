import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "e2e-owner@example.com";
const password = process.env.E2E_PASSWORD ?? "E2E-Launch-Password-123!";

test("user can enroll a passkey and sign in passwordlessly", async ({ page, context }) => {
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
    await page.getByRole("tab", { name: /security/i }).click();
    await expect(page.getByRole("heading", { name: "Passkeys", exact: true })).toBeVisible();

    await page.getByLabel("Passkey name").fill("CI virtual passkey");
    await page.locator('input[name="passkey_current_password"]').fill(password);
    await page.getByRole("button", { name: "Verify & add passkey" }).click();

    // Surface WebAuthn browser failures in the CI log instead of reporting only
    // a generic timeout when navigator.credentials.create() rejects.
    await expect.poll(async () => {
      if (await page.getByText("Passkey added. You can now use it from the sign-in page.").isVisible()) {
        return "success";
      }
      const alert = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Passkeys", exact: true }),
      }).locator('[role="alert"]').first();
      if (await alert.isVisible()) return `browser error: ${await alert.innerText()}`;
      return "pending";
    }, { timeout: 15_000 }).toBe("success");
    await expect(page.getByText("CI virtual passkey")).toBeVisible();

    // Clear only browser cookies to prove the next authentication starts without
    // an existing Business OS access/refresh session. The virtual authenticator
    // keeps the discoverable credential exactly like a device passkey would.
    await context.clearCookies();
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // Conditional WebAuthn may complete automatically in supporting Chrome
    // versions. Otherwise exercise the explicit passkey button.
    await page.waitForTimeout(500);
    if (page.url().includes("/login")) {
      await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    }
    await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/, { timeout: 15_000 });
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
    await cdp.send("WebAuthn.disable").catch(() => undefined);
  }
});
