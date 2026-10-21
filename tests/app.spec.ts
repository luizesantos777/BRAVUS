import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name, exact: true }).click();
}
test('gestão completa: clientes, tarefas, finanças, persistência e restauração', async ({ page }, info) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu negócio, em movimento.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await navigate(page, 'Clientes');
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
  await page.getByLabel('Nome do cliente').fill('Ana Oliveira');
  await page.getByLabel('Empresa', { exact: true }).fill('Studio Inicial');
  await page.getByLabel('E-mail', { exact: true }).fill('ana@example.com');
  await page.getByLabel('Telefone').fill('(11) 99999-9999');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page.getByRole('cell', { name: 'Ana Oliveira', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Ana Oliveira', exact: true }).click();
  await page.getByLabel('Empresa', { exact: true }).fill('Studio Ana');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('inexistente');
  await expect(page.getByRole('heading', { name: 'Nenhum cliente encontrado' })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar busca' }).click();
  await expect(page.getByRole('cell', { name: 'Studio Ana', exact: true })).toBeVisible();

  await navigate(page, 'Tarefas');
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  await page.getByLabel('Título da tarefa').fill('Enviar proposta');
  await page.getByLabel('Cliente vinculado').selectOption({ label: 'Ana Oliveira' });
  await page.getByLabel('Prioridade', { exact: true }).selectOption('high');
  await page.getByLabel('Status', { exact: true }).selectOption('doing');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  await page.getByRole('button', { name: 'Concluir tarefa Enviar proposta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reabrir tarefa Enviar proposta', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Concluída/ }).click();
  await expect(page.getByText('Enviar proposta', { exact: true })).toBeVisible();

  await navigate(page, 'Financeiro');
  async function addMovement(description: string, type: string, amount: string) {
    await page.getByRole('button', { name: 'Novo lançamento', exact: true }).click();
    await page.getByRole('textbox', { name: /^Descrição/ }).fill(description);
    await page.getByLabel('Tipo', { exact: true }).selectOption(type);
    await page.getByLabel('Valor (R$)').fill(amount);
    await page.getByLabel('Cliente vinculado').selectOption({ label: 'Ana Oliveira' });
    await page.getByRole('button', { name: 'Salvar lançamento' }).click();
  }
  await addMovement('Projeto site', 'income', '1250,50');
  await addMovement('Assinatura', 'expense', '200,25');
  const balance = page.locator('.stat.dark');
  await expect(balance).toContainText(/1\.050,25/);
  await page.getByRole('button', { name: 'Editar Assinatura', exact: true }).click();
  await page.getByLabel('Valor (R$)').fill('250,25');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(balance).toContainText(/1\.000,25/);
  await page.getByLabel('Tipo de movimentação').selectOption('expense');
  await expect(page.getByRole('cell', { name: 'Projeto site', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Assinatura', exact: true })).toBeVisible();
  await page.getByLabel('Tipo de movimentação').selectOption('all');
  await page.reload();
  await expect(balance).toContainText(/1\.000,25/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await navigate(page, 'Dados e backup');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar backup', exact: true }).click();
  const download = await downloadPromise;
  const file = info.outputPath('bravus-backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8'));
  expect(backup.clients).toHaveLength(1);
  expect(backup.tasks[0].status).toBe('done');
  expect(backup.transactions.map((item: { amount: number }) => item.amount)).toEqual([125050, 25025]);

  await navigate(page, 'Clientes');
  await page.getByRole('button', { name: 'Excluir Ana Oliveira', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('As tarefas e movimentações serão mantidas');
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(page.getByRole('heading', { name: 'Boas conexões começam aqui' })).toBeVisible();
  await navigate(page, 'Financeiro');
  await expect(balance).toContainText(/1\.000,25/);
  await expect(page.getByRole('cell', { name: 'Sem cliente', exact: true })).toHaveCount(2);

  await navigate(page, 'Dados e backup');
  await page.getByLabel('Arquivo de backup').setInputFiles(file);
  await expect(page.getByRole('dialog')).toContainText('1 clientes, 1 tarefas e 2 movimentações');
  await page.getByRole('button', { name: 'Confirmar restauração' }).click();
  await navigate(page, 'Clientes');
  await expect(page.getByRole('cell', { name: 'Ana Oliveira', exact: true })).toBeVisible();
  await navigate(page, 'Visão geral');
  await expect(page.getByRole('img', { name: /receitas/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('dashboard.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test('backup inválido é rejeitado e dados locais corrompidos são preservados', async ({ page }) => {
  await page.goto('/#backup');
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.getByRole('alert')).toContainText('Arquivo inválido');
  await page.evaluate(() => localStorage.setItem('bravus.data.v1', 'corrupted-original'));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('O conteúdo original foi preservado');
  await navigate(page, 'Clientes');
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
  await page.getByLabel('Nome do cliente').fill('Não sobrescrever');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  expect(await page.evaluate(() => localStorage.getItem('bravus.data.v1'))).toBe('corrupted-original');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('formulário impede valores inválidos e janela fecha com Escape', async ({ page }) => {
  await page.goto('/#financeiro');
  await page.getByRole('button', { name: 'Novo lançamento', exact: true }).click();
  await page.getByRole('textbox', { name: /^Descrição/ }).fill('Teste de valor');
  await page.getByLabel('Valor (R$)').fill('-25');
  await page.getByRole('button', { name: 'Salvar lançamento' }).click();
  await expect(page.getByRole('alert')).toContainText('Informe um valor');
  expect(await page.evaluate(() => localStorage.getItem('bravus.data.v1'))).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
