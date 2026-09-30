import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getReadingStatus } from "~/utils/order-status";
import { readingShare } from "~/utils/share-reading";
import { completePurchaseTracking } from "~/utils/analytics";
import { QUIZ_DRAFT_KEY } from "~/utils/quiz-draft";
export const Route = createFileRoute("/thank-you")({ component: ThankYouPage });
type Status = Awaited<ReturnType<typeof getReadingStatus>>;
function ThankYouPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("Checking your order…");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      objectUrl: string | undefined,
      attempts = 0;
    async function check() {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const orderId =
          hash.get("order") ||
          new URLSearchParams(window.location.search).get("order");
        const accessToken =
          hash.get("access") ||
          (orderId
            ? sessionStorage.getItem(`syrena_order_access_${orderId}`)
            : null);
        if (!orderId || !accessToken)
          throw Error(
            "Use your private reading email link, or return in the tab where you checked out.",
          );
        const result = await getReadingStatus({
          data: { orderId, accessToken },
        });
        if (cancelled) return;
        setStatus(result);
        if (result.paid) completePurchaseTracking();
        setMessage(
          !result.paid
            ? "Payment has not been confirmed yet. If you just paid, check again shortly."
            : result.stage === "review"
              ? "Your payment is recorded. Delivery needs a review; please do not purchase again."
              : result.stage === "complete"
                ? "Your text and audio are ready."
                : "Your payment is recorded. Your reading is being prepared; you can safely check again.",
        );
        if (result.audioReady && !objectUrl) {
          const response = await fetch("/api/reading-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId, accessToken }),
          });
          if (response.ok) {
            const blob = await response.blob();
            if (cancelled) return;
            objectUrl = URL.createObjectURL(blob);
            setAudioUrl(objectUrl);
          }
        }
        if (
          !cancelled &&
          !["complete", "review"].includes(result.stage) &&
          ++attempts < 24
        )
          timer = setTimeout(check, 5000);
      } catch {
        if (!cancelled)
          setMessage(
            "This order is unavailable here. Use the private link in your reading email, or return in the original checkout tab.",
          );
      }
    }
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [refresh]);
  return (
    <main className="min-h-dvh cosmic-gradient px-6 py-12 text-white">
      <div className="max-w-lg mx-auto space-y-6">
        <p className="text-sm text-gold">Syrena · The Origin Codex</p>
        <h1 className="text-2xl">Your reading</h1>
        <p role="status">{message}</p>
        <button
          className="glow-button p-3 rounded-xl"
          onClick={() => {
            setAudioUrl(null);
            setRefresh((v) => v + 1);
          }}
        >
          Check order again
        </button>
        {status?.paid && status.reading && (
          <>
            <section
              className="cosmic-card p-6 rounded-2xl text-center space-y-3"
              aria-label="Public share card"
            >
              <p className="text-sm text-gold">THE ORIGIN CODEX</p>
              <h2 className="text-2xl">{status.archetype}</h2>
              <p>An archetype for reflection, with Syrena</p>
              <button
                className="glow-button p-3 rounded-xl"
                onClick={async () => {
                  const payload = readingShare(
                    status.paid,
                    Boolean(status.reading),
                    status.archetype,
                  );
                  if (!payload) return;
                  try {
                    if (navigator.share) {
                      await navigator.share(payload);
                      setShareMessage("Share action completed.");
                    } else {
                      await navigator.clipboard.writeText(
                        `${payload.text} ${payload.url}`,
                      );
                      setShareMessage("Public summary copied.");
                    }
                  } catch (error) {
                    if (
                      !(
                        error instanceof DOMException &&
                        error.name === "AbortError"
                      )
                    )
                      setShareMessage(
                        "Sharing is unavailable in this browser. You can copy the public site address: https://syrenacodex.com/",
                      );
                  }
                }}
              >
                Share your archetype
              </button>
              <p className="text-sm text-gray-400">
                Shares your archetype and the public site link. Your reading and
                private access link stay private.
              </p>
              <p role="status">{shareMessage}</p>
            </section>
            <h2>
              {status.name} · {status.archetype}
            </h2>
            <div className="cosmic-card p-6 rounded-2xl whitespace-pre-line">
              {status.reading.primary}
            </div>
            {status.reading.shadow && (
              <section className="cosmic-card p-6 rounded-2xl">
                <h2>Shadow Origin</h2>
                <p className="whitespace-pre-line">{status.reading.shadow}</p>
              </section>
            )}
          </>
        )}
        {audioUrl && <audio controls src={audioUrl} className="w-full" />}
        {status?.emailAccepted && (
          <p>
            {status.emailDelivered
              ? "Our email provider confirmed delivery. This does not confirm that the message was read or placed in your inbox."
              : "Email accepted by our delivery provider. Delivery is not yet confirmed."}
          </p>
        )}
        <p className="text-sm text-gray-400">
          AI-generated for entertainment and self-reflection.
        </p>
        <button
          className="text-sm underline"
          onClick={() => {
            sessionStorage.removeItem(QUIZ_DRAFT_KEY);
            sessionStorage.removeItem("syrena_checkout_attempt");
            navigate({ to: "/quiz" });
          }}
        >
          Start a new quiz
        </button>
      </div>
    </main>
  );
}
