"use client";

import { CreditCard, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";

import { useCheckout, usePaymentMethods } from "../hooks";

/**
 * The button that starts a payment.
 *
 * Pressing it records a transaction and sends the learner to the provider's own page. Their
 * card is entered there and never here: this app has no field that accepts one, and the
 * callbacks the provider sends back carry identifiers and an amount, nothing else.
 *
 * A plan with no price in the provider's currency does not get a button at all. Offering a
 * checkout that the API will refuse is worse than saying plainly that it is not available.
 */
export function CheckoutButton({
  planCode,
  planName,
  payable,
  isCurrent,
  className,
}: {
  planCode: string;
  planName: string;
  payable: boolean;
  isCurrent: boolean;
  className?: string;
}) {
  const methods = usePaymentMethods();
  const checkout = useCheckout();

  if (isCurrent) {
    return (
      <Button className={className} variant="outline" disabled>
        Your plan
      </Button>
    );
  }
  if (!payable) {
    return (
      <Button className={className} variant="outline" disabled>
        Not available yet
      </Button>
    );
  }
  if (methods.isPending) {
    return (
      <Button className={className} disabled>
        Checking…
      </Button>
    );
  }
  if (!methods.data?.available) {
    return (
      <Button className={className} variant="outline" disabled>
        Online payment is off
      </Button>
    );
  }

  const providerName = methods.data.provider === "click" ? "Click" : methods.data.provider;

  return (
    <Button
      className={className}
      loading={checkout.isPending}
      onClick={() =>
        checkout.mutate(planCode, {
          onSuccess: (result) => {
            // Leaving for the provider is the point of the button, so it happens in this
            // tab: a popup here is the one a browser blocks.
            window.location.href = result.url;
          },
          onError: (error) =>
            toast({
              title: `${planName} could not be started`,
              description: isApiError(error) ? error.message : undefined,
              variant: "error",
            }),
        })
      }
    >
      <CreditCard aria-hidden />
      Pay with {providerName}
      <ExternalLink className="size-3.5 opacity-70" aria-hidden />
    </Button>
  );
}
