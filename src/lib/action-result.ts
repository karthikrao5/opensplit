import { NotMemberError } from '@/lib/membership'

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Runs an action body and converts known failures into a value the form can
 * render. NotMemberError becomes 'Not found' so non-members learn nothing
 * about whether the group exists.
 */
export async function runAction(
  fn: () => Promise<void>,
): Promise<ActionResult> {
  try {
    await fn()
    return { ok: true }
  } catch (error) {
    if (error instanceof NotMemberError) return { ok: false, error: 'Not found' }
    if (error instanceof ValidationError) return { ok: false, error: error.message }
    throw error
  }
}

/** Thrown by actions for input the user can fix. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
