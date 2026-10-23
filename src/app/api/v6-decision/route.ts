import { createRateLimiter } from '@/lib/rate-limit';
import { createV6DecisionRoute } from '@/lib/v6-decision-route';
import { getV6ShadowDecision } from '@/lib/v6-decision-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const rateLimiter = createRateLimiter({ limit: 8, windowMs: 60_000 });

export const GET = createV6DecisionRoute({
  getDecision: getV6ShadowDecision,
  rateLimiter,
});
