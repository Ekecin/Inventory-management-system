
import { test, expect } from "@playwright/test";

test("user can log in and access the inventory dashboard", async ({
  page,
}) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  // Make sure the test credentials are configured.
  test.skip(
    !email || !password,
    "Set E2E_EMAIL and E2E_PASSWORD in .env.local"
  );

  // 1. Open the actual application.
  await page.goto("/");

  // 2. Confirm that the login screen is displayed.
  await expect(
    page.getByRole("heading", {
      name: "Sign in to your workspace",
    })
  ).toBeVisible();

  // 3. Enter the test account credentials.
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);

  // 4. Submit the login form.
  await page.getByRole("button", {
    name: "Sign in",
    exact: true,
  }).click();

  // 5. Confirm that the authenticated dashboard appears.
  await expect(
    page.getByRole("heading", {
      name: "Good to see you.",
    })
  ).toBeVisible({ timeout: 15_000 });

  // 6. Confirm that inventory content is available.
  await expect(
    page.getByRole("heading", {
      name: "Inventory overview",
    })
  ).toBeVisible();

  await expect(
    page.getByRole("button", {
      name: /Add item/,
    })
  ).toBeVisible();
});
