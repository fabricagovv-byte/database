import { expect, test } from "@playwright/test";

test("portal abre e mostra a situação da plataforma", async ({ page }) => {
  await page.route("**/api/health", (rota) =>
    rota.fulfill({ json: { status: "ok", versao: "0.1.0", componentes: { postgres: "ok", redis: "ok" } } }),
  );
  await page.goto("/");
  await expect(page).toHaveTitle(/Portal de Gestão Multinuvem/);
  await expect(page.getByRole("heading", { name: "Situação da plataforma" })).toBeVisible();
  await expect(page.getByText("Operacional", { exact: true })).toBeVisible();
});
