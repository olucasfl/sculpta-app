import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Telas principais nos 5 viewports: sem rolagem horizontal, sem violações graves de acessibilidade (axe)
 * e uma captura por tela em e2e/screenshots/<viewport>/<tela>.png para revisão visual.
 * Contas de DEMONSTRAÇÃO do seed local (a pilha de teste é isolada do banco real).
 */
const PASSWORD = 'Simulador#2026';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await dismissWelcome(page);
}

/** O popup de boas-vindas aparece na primeira entrada de cada conta. */
async function dismissWelcome(page: Page) {
  const start = page.getByRole('button', { name: 'Começar' });
  try {
    await start.waitFor({ state: 'visible', timeout: 3_000 });
    await start.click();
  } catch {
    /* já tinha sido visto */
  }
}

async function check(page: Page, name: string) {
  const dir = join('e2e', 'screenshots', test.info().project.name);
  mkdirSync(dir, { recursive: true });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `rolagem horizontal em ${name}`).toBeLessThanOrEqual(0);

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`),
    `violações de acessibilidade em ${name}`,
  ).toEqual([]);
}

test.describe('telas públicas', () => {
  test('login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await check(page, '01-login');
  });

  test('cadastro: a confirmação da senha é obrigatória', async ({ page }) => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome completo').fill('Pessoa Teste');
    await page.getByLabel('E-mail').fill('pessoa@teste.test');
    await page.getByLabel('Senha', { exact: true }).fill('uma-senha-bem-longa-1');
    await page.getByLabel('Confirme a senha').fill('outra-senha-bem-longa-2');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText('As senhas não conferem')).toBeVisible();
    await check(page, '02-cadastro');
  });
});

test.describe('dona da clínica', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'admin@demo.local'));

  test('visão geral', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Olá');
    await check(page, '03-visao-geral');
  });

  test('pacientes: tabela no tablet/desktop, cartões no celular', async ({ page }, info) => {
    await page.goto('/patients');
    await expect(page.getByRole('link', { name: /Paciente Fictícia A/ }).filter({ visible: true }).first()).toBeVisible();
    const phone = (info.project.use.viewport?.width ?? 1000) < 768;
    await expect(page.locator('table')).toBeVisible({ visible: !phone });
    await check(page, '04-pacientes');
  });

  test('ficha do paciente e termo de consentimento', async ({ page }) => {
    await page.goto('/patients');
    await page.getByRole('link', { name: /Paciente Fictícia A/ }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Paciente Fictícia A' })).toBeVisible();
    await check(page, '05-ficha-paciente');
    const consentUrl = page.url().replace(/\/?$/, '/consent');
    await page.goto(consentUrl);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check(page, '06-termo');
  });

  test('configurações: clínica, equipe e conta', async ({ page }) => {
    await page.goto('/settings');
    await check(page, '07-configuracoes-clinica');
    await page.goto('/settings?aba=usuarios');
    await expect(page.getByRole('heading', { name: 'Convites' })).toBeVisible();
    await check(page, '08-configuracoes-equipe');
    await page.goto('/settings?aba=conta');
    await expect(page.getByLabel('Confirme a nova senha')).toBeVisible();
    await check(page, '09-configuracoes-conta');
  });

  test('captura e simulações', async ({ page }) => {
    await page.goto('/capture');
    await check(page, '10-captura-inicio');
    await page.goto('/simulations');
    await check(page, '11-simulacoes');
  });
});

test.describe('administrador da plataforma', () => {
  test('console: clínicas e contas', async ({ page }) => {
    await signIn(page, 'plataforma@demo.local');
    await expect(page).toHaveURL(/\/plataforma/);
    await expect(page.getByRole('heading', { name: 'Plataforma' })).toBeVisible();
    await check(page, '12-plataforma-clinicas');
    await page.goto('/plataforma/contas');
    await check(page, '13-plataforma-contas');
  });
});
