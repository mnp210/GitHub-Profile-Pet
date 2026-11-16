// src/app/api/pet/action/route.ts
// Next.js App Router API Route for Server-Authoritative Care Actions

import { resolveServerUser } from '../../../../lib/auth/sessionContext.ts';
import { validateCareActionPayload } from '../../../../lib/gameplay/validation.ts';
import { GameplayService } from '../../../../lib/gameplay/gameplayService.ts';
import { verifyRequestOrigin } from '../../../../lib/security/csrf.ts';

export async function POST(request: Request) {
  try {
    // 1. Origin verification for CSRF protection
    const originCheck = verifyRequestOrigin(request);
    if (!originCheck.valid) {
      return Response.json({ error: 'FORBIDDEN', message: originCheck.reason }, { status: 403 });
    }

    // 2. Authenticated User Identification from trusted server-side context
    const authContext = await resolveServerUser(request);
    if (!authContext) {
      return Response.json(
        {
          error: 'UNAUTHORIZED',
          message: 'Authentication required. Server could not resolve a trusted user identity.',
        },
        { status: 401 }
      );
    }

    // 2. Parse JSON Body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json(
        {
          error: 'INVALID_JSON',
          message: 'Malformed request body. Expected valid JSON.',
        },
        { status: 400 }
      );
    }

    // 3. Request Payload Validation
    const validation = validateCareActionPayload(rawBody);
    if (!validation.valid) {
      return Response.json(
        {
          error: 'VALIDATION_FAILED',
          message: validation.error,
        },
        { status: 400 }
      );
    }

    const { action, clientActionId } = validation.data;

    // 4. Execute Server-Authoritative Gameplay Action
    const result = await GameplayService.handleAction({
      userId: authContext.userId,
      action,
      clientActionId,
    });

    // 5. Serialize Response
    if (result.success) {
      return Response.json(result, { status: 200 });
    }

    // Handle Cooldown rejection
    if (result.cooldownRemainingMs !== undefined) {
      return Response.json(
        {
          error: 'ACTION_COOLDOWN',
          ...result,
        },
        { status: 429 }
      );
    }

    // Handle pre-condition rejection (e.g. insufficient energy or satiety full)
    return Response.json(
      {
        error: 'PRECONDITION_FAILED',
        ...result,
      },
      { status: 422 }
    );
  } catch (error) {
    console.error('[API /api/pet/action Error]:', (error as Error).message);
    return Response.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected database or server error occurred.',
      },
      { status: 500 }
    );
  }
}
