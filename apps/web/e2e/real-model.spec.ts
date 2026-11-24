import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Conferência (não faz parte da suíte): o simulador completo com o modelo REAL reconstruído de uma pessoa.
 * O arquivo do modelo vem de REAL_GLB e substitui o modelo demonstrativo no navegador (a pilha de teste é isolada).
 */
const PASSWORD = 'Simulador#2026';
const GLB = process.env.REAL_GLB ?? '';

async function open(page: Page) {
  await page.route('**/models/template-head.glb', (route) => route.fulfill({ path: GLB, contentType: 'model/gltf-binary' }));
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('profissional@demo.local');
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const start = page.getByRole('button', { name: 'Começar' });
  try {
    await start.waitFor({ state: 'visible', timeout: 3_000 });
    await start.click();
  } catch {
    /* popup já visto */
  }
  await page.goto('/simulations');
  await page.getByRole('link', { name: /Simulação de demonstração/ }).first().click();
  await expect(page.getByText(/vértices/)).toBeVisible({ timeout: 60_000 });
}

test('modelo real: cabelo automático, perfil, lábios, diferença, cabelo longo e nariz', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440x900' || !GLB, 'só roda com REAL_GLB apontando para um .glb reconstruído');
  test.setTimeout(600_000);
  const dir = join('e2e', 'screenshots', info.project.name);
  mkdirSync(dir, { recursive: true });
  const shot = async (name: string, wait = 6_000) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: join(dir, name) });
  };
  await open(page);
  await shot('50-real-frente.png', 15_000);

  // perfil esquerdo pelo painel Comparar
  await page.getByRole('button', { name: 'Comparar' }).click();
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: '45° esq.' }).click();
  await shot('51-real-45.png', 8_000);
  if (process.env.REAL_ONLY === 'front') return;
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Perfil esq.' }).click();
  await shot('52-real-perfil.png', 8_000);
  if (process.env.REAL_ONLY === 'profile') return;
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Frente' }).click();
  await page.getByRole('button', { name: 'Fechar comparação' }).click();

  // lábios volumosos
  await page.getByRole('button', { name: 'Lábios', exact: true }).click();
  await page.getByRole('button', { name: /Volumoso/ }).click();
  await shot('53-real-labios-volumoso.png', 8_000);

  // diferença em mm
  await page.getByRole('button', { name: /Comparar/ }).click();
  await page.getByRole('group', { name: 'Modo de comparação' }).getByRole('button', { name: 'Diferença' }).click();
  await page.getByRole('button', { name: 'Fechar comparação' }).click();
  await shot('54-real-diferenca.png', 6_000);
  await page.getByRole('button', { name: /Comparar/ }).click();
  await page.getByRole('group', { name: 'Modo de comparação' }).getByRole('button', { name: 'Simulação' }).click();
  await page.getByRole('button', { name: 'Fechar comparação' }).click();

  // nariz: ponta mais projetada, em perfil
  await page.getByRole('button', { name: 'Nariz', exact: true }).click();
  await page.getByRole('button', { name: /Ponta mais projetada/ }).click();
  await page.getByRole('button', { name: /Comparar/ }).click();
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Perfil esq.' }).click();
  await page.getByRole('button', { name: 'Fechar comparação' }).click();
  await shot('55-real-nariz-perfil.png', 10_000);

  // cabelo: lista de modelos e um longo ondulado
  await page.getByRole('tab', { name: 'Aparência' }).click();
  await shot('56-real-aparencia.png', 3_000);
  await page.getByRole('button', { name: 'Longo ondulado com franja' }).click();
  await page.getByRole('button', { name: /Comparar/ }).click();
  await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: 'Frente' }).click();
  await page.getByRole('button', { name: 'Fechar comparação' }).click();
  await shot('57-real-cabelo-longo.png', 25_000);
  for (const [view, file] of [['45° esq.', '57b-real-cabelo-longo-45.png'], ['Perfil esq.', '57c-real-cabelo-longo-perfil.png']] as const) {
    await page.getByRole('button', { name: /Comparar/ }).click();
    await page.getByRole('group', { name: 'Vistas' }).getByRole('button', { name: view }).click();
    await page.getByRole('button', { name: 'Fechar comparação' }).click();
    await shot(file, 8_000);
  }
  await page.getByRole('button', { name: 'Automático (da foto)' }).click();
  await shot('58-real-cabelo-auto-de-novo.png', 12_000);
});
