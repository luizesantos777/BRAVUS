import { expect, test } from '@playwright/test';
const key = 'fixture_browser_admin_012345678901234567890123456789', admin = { Authorization: `Bearer ${key}` };

test('admin exclui o cadastro revogado vazio por ID, conserva homônimo ativo e bloqueia histórico financeiro', async ({ page }, info) => {
  const name = `parceiro ${info.project.name}`, create = async (suffix: string) => {
    const result = await page.request.post('/api/admin/attendants', { headers: admin, data: { name, accountKind: 'partner', token: `fixture_delete_${suffix}_${info.project.name}_01234567890123456789` } });
    expect(result.status()).toBe(201);return await result.json() as { attendantId: string; token: string };
  };
  const target = await create('empty'), survivor = await create('active'), protectedAccount = await create('history');
  expect((await page.request.post(`/api/admin/attendants/${protectedAccount.attendantId}/costs`, { headers: admin, data: { date: (await (await page.request.get('/api/portal', { headers: { Authorization: `Bearer ${protectedAccount.token}` } })).json()).today, ads: '1', withdrawalFee: '0' } })).status()).toBe(200);
  expect((await page.request.patch(`/api/admin/attendants/${protectedAccount.attendantId}`, { headers: admin, data: { active: false } })).status()).toBe(200);
  await page.goto('/#/admin');await page.getByLabel('Chave administrativa').fill(key);await page.getByRole('button', { name: 'Entrar na administração', exact: true }).click();
  await page.getByRole('button', { name: 'Atendentes', exact: true }).click();
  const row = (id: string) => page.locator(`.admin-attendants tbody tr[data-account-id="${id}"]`), targetRow = row(target.attendantId);
  await expect(targetRow.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0);
  await expect(row(protectedAccount.attendantId).getByRole('button', { name: 'Excluir', exact: true })).toBeDisabled();
  const revoke = page.waitForEvent('dialog');const revokeClick = targetRow.getByRole('button', { name: 'Revogar', exact: true }).click();await (await revoke).accept();await revokeClick;
  const remove = targetRow.getByRole('button', { name: 'Excluir', exact: true });await expect(remove).toBeEnabled();
  const cancel = page.waitForEvent('dialog');const cancelClick = remove.click();await (await cancel).dismiss();await cancelClick;await expect(targetRow).toHaveCount(1);
  const confirm = page.waitForEvent('dialog');const click = remove.click();const dialog = await confirm;expect(dialog.message()).toContain(name);await dialog.accept();await click;
  await expect(page.getByRole('status')).toContainText('Cadastro revogado excluído.');await expect(targetRow).toHaveCount(0);
  await expect(row(survivor.attendantId)).toHaveCount(1);await expect(row(survivor.attendantId).getByRole('button', { name: 'Revogar', exact: true })).toBeVisible();await expect(row(protectedAccount.attendantId)).toHaveCount(1);
  const dashboard = await (await page.request.get('/api/admin/dashboard?refresh=1', { headers: admin })).json();
  expect(dashboard.attendants.some((account: { id: string }) => account.id === target.attendantId)).toBe(false);
  const audit = await (await page.request.get('/api/admin/audit?action=attendant.deleted', { headers: admin })).json();expect(audit.entries.some((entry: { targetId: string }) => entry.targetId === target.attendantId)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('cadastro-revogado-excluido.png'), fullPage: true });
});
