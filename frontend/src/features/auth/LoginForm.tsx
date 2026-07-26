import { useState, type ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
} from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabaseClient'
import { stashLoginRedirect } from '@/features/auth/loginRedirect'

interface LoginFormProps extends ComponentProps<'div'> {
  /** Path to open after OAuth returns (stored before redirect). */
  redirectPath: string
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 12 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export function LoginForm({ className, redirectPath, ...props }: LoginFormProps) {
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleGoogleSignIn() {
    setErrorMessage('')
    setIsSubmitting(true)
    stashLoginRedirect(redirectPath)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/login`,
        queryParams: {
          prompt: 'select_account',
        },
      },
    })

    if (error) {
      setIsSubmitting(false)
      setErrorMessage(error.message)
    }
    // On success the browser navigates away to Google.
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card className="rounded-xl border border-zinc-200 bg-white text-foreground shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-semibold tracking-tight">
            登录 xEngine
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            使用 Google 账号继续
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field className="gap-3">
              {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleGoogleSignIn()}
                className="h-11 w-full gap-2 rounded-full border border-zinc-200 bg-white font-semibold text-zinc-900 shadow-none hover:bg-zinc-50"
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="size-4" />
                    正在跳转 Google…
                  </>
                ) : (
                  <>
                    <GoogleMark className="size-4" />
                    使用 Google 继续
                  </>
                )}
              </Button>
              <FieldDescription className="text-center text-xs text-muted-foreground">
                首次登录将自动创建账号，无需单独注册
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
