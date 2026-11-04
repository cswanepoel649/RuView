import { z } from 'zod';
import { CommandResult } from '@ruview/shared/protocol';
import { adminClient } from '@/lib/supabase/admin';
import { ApiError, authenticateGateway, handle, json, pgError, readJson } from '@/lib/gateway-api';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req, ctx) => {
  const gatewayId = await authenticateGateway(req);
  const id = z.guid().safeParse((await ctx.params).id);
  if (!id.success) throw new ApiError(400, 'invalid command id');
  const body = await readJson(req, CommandResult);
  const { error } = await adminClient().rpc('gateway_complete_command', {
    p_gateway: gatewayId, p_command: id.data, p_success: body.success, p_result: body.result ?? {}, p_error: body.error ?? null,
  });
  if (error) throw pgError(error);
  return json(200, { ok: true });
});
