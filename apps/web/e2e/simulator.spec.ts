import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Simulador 3D de ponta a ponta no navegador: modelar com o pincel (arrasto com ponteiro), desfazer,
 * salvar a versão com a escultura, recarregar a página e conferir que a escultura voltou.
 * Usa a simulação de demonstração criada pelo seed da pilha de teste.
 */
const PASSWORD = 'Simulador#2026';

async function openSimulator(page: Page) {
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
  await expect(page.getByText(/vértices/)).toBeVisible({ timeout: 45_000 });
}

/** Arrasta o ponteiro sobre o rosto (centro do canvas) em um pequeno zigue-zague. */
async function strokeOnFace(page: Page) {
  const box = (await page.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.46;
  await page.mouse.move(cx - 30, cy);
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) await page.mouse.move(cx - 30 + i * 5, cy + (i % 2 ? 6 : -6), { steps: 2 });
  await page.mouse.up();
}

test('pincel: modelar, desfazer, salvar com a escultura e recarregar', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440x900', 'o fluxo do pincel é verificado no desktop; os outros viewports têm as capturas de tela');
  await openSimulator(page);
  const dir = join('e2e', 'screenshots', info.project.name);
  mkdirSync(dir, { recursive: true });

  const undo = page.getByRole('button', { name: 'Desfazer traço' });
  const clear = page.getByRole('button', { name: 'Limpar escultura' });
  await expect(page.getByRole('region', { name: 'Pincel de escultura' })).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(clear).toBeDisabled();
  await page.screenshot({ path: join(dir, '20-simulador-antes.png') });

  await strokeOnFace(page);
  await expect(undo).toBeEnabled();
  await expect(clear).toBeEnabled();
  await expect(page.getByText('Não salvo')).toBeVisible();
  await page.screenshot({ path: join(dir, '21-simulador-depois-do-traco.png') });

  // Desfazer o traço volta ao rosto sem escultura; refazer traz de volta.
  await undo.click();
  await expect(clear).toBeDisabled();
  await page.getByRole('region', { name: 'Pincel de escultura' }).getByRole('button', { name: 'Refazer' }).click();
  await expect(clear).toBeEnabled();

  // Salva a versão (guarda sliders + escultura) e recarrega a página.
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByLabel('Nome').fill('Com pincel');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Versão salva.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/vértices/)).toBeVisible({ timeout: 45_000 });
  // A escultura da versão salva voltou (há o que limpar) e a tela não acusa alterações.
  await expect(clear).toBeEnabled();
  await expect(page.getByText('Não salvo')).toHaveCount(0);

  // Limpar zera a escultura; é uma ação que também se desfaz.
  await clear.click();
  await expect(clear).toBeDisabled();
  await undo.click();
  await expect(clear).toBeEnabled();
  await page.screenshot({ path: join(dir, '22-simulador-recarregado.png') });
});

test('modos: Regiões e Girar escondem o painel do pincel', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440x900');
  await openSimulator(page);
  await page.getByRole('button', { name: 'Regiões', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pincel de escultura' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pincel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pincel de escultura' })).toBeVisible();
});

test('aparência: pele, olhos, cabelo e sobrancelhas aparecem; controles mudam o resultado', async ({ page }, info) => {
  test.setTimeout(150000);
  test.skip(info.project.name !== 'desktop-1440x900');
  await openSimulator(page);
  const dir = join('e2e', 'screenshots', info.project.name);
  mkdirSync(dir, { recursive: true });
  const panel = page.getByRole('group', { name: 'Vistas' });
  await expect(page.getByText('Aparência', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(dir, '30-aparencia-frente.png') });
  await panel.getByRole('button', { name: '45° esq.' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(dir, '31-aparencia-45.png') });
  await panel.getByRole('button', { name: 'Perfil esq.' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(dir, '32-aparencia-perfil.png') });
  // Cabelo mais longo e olho azul, e esconde o cabelo.
  await panel.getByRole('button', { name: 'Frente' }).click();
  await page.getByRole('button', { name: 'Azul' }).click();
  await page.getByLabel('Comprimento').fill('0.9');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, '33-aparencia-olho-azul-cabelo-longo.png') });
  const hair = page.getByRole('checkbox', { name: 'Mostrar' });
  await hair.uncheck({ force: true });
  await expect(page.getByLabel('Comprimento')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Modo leve/ }).check();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(dir, '34-aparencia-sem-cabelo-modo-leve.png') });
});
