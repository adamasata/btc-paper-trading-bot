import { createDecisionRoute } from '@/lib/decision-route';
import { createRateLimiter } from '@/lib/rate-limit';
import { getLatestDecision } from '@/lib/decision-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const rateLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export const GET = createDecisionRoute({
  getDecision: getLatestDecision,
  rateLimiter,
});
