import { panelGuard } from '@/lib/gateway-access';
import { checkoutOperationalHealth } from '@/lib/operational-health';
import { json } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await panelGuard(req);
  if (denied) return denied;
  try {
    const health = await checkoutOperationalHealth();
    return json({ ...health, checkedAt: new Date().toISOString() }, health.ok ? 200 : 503);
  } catch {
    return json({ ok: false, alerts: [{ reason: 'database_unavailable' }], checkedAt: new Date().toISOString() }, 503);
  }
}
