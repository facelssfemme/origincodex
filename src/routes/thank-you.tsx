import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { archetypeStars, type QuizAnswers, type Archetype, type QuizResult } from "~/utils/scoring";

export const Route = createFileRoute("/thank-you")({
  component: ThankYouPage,
});

interface ThankYouSearch {
  session_id?: string;
}

function ThankYouPage() {
  const navigate = useNavigate();
  const { session_id } = useSearch({ from: Route.id }) as ThankYouSearch;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [quizData, setQuizData] = useState<{
    name: string;
    archetype: string;
    secondaryArchetype: string;
    sunSign: string;
    includeShadow: boolean;
  } | null>(null);

  useEffect(() => {
    // Read quiz data from localStorage
    try {
      const stored = localStorage.getItem("syrena_quiz_data");
      if (stored) {
        const parsed = JSON.parse(stored);
        setQuizData(parsed);
      }

      if (session_id) {
        console.log("Stripe session ID:", session_id);
        // In future builds: verify session and trigger LLM generation + email
      }

      // Brief delay for dramatic effect
      const timer = setTimeout(() => setStatus("ready"), 1500);
      return () => clearTimeout(timer);
    } catch (e) {
      console.error("Failed to read quiz data:", e);
      setStatus("ready");
    }
  }, [session_id]);

  if (status === "loading") {
    return (
      <main className="relative min-h-dvh flex flex-col items-center justify-center px-6 cosmic-gradient overflow-hidden">
        {/* Stars */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          {Array.from({ length: 30 }, (_, i) => (
            <div
              key={i}
              className="star"
              style={{
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                animationDuration: `${2 + Math.random() * 4}s`,
                animationDelay: `${Math.random() * 5}s`,
              }}
            />
          ))}
        </div>

        <div className="relative z-10 flex flex-col items-center gap-8 text-center">
          <div className="relative w-24 h-24 mb-4">
            <div className="absolute inset-0 rounded-full bg-violet-600/20 swirl-ring" />
            <div className="absolute inset-2 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: "2s" }} />
            <div className="absolute inset-4 rounded-full bg-gold/20 reading-animation" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">✦</span>
            </div>
          </div>
          <h2 className="text-2xl font-light text-white">
            Payment confirmed...
          </h2>
          <p className="text-sm text-gray-400/60 max-w-xs">
            Your reading is being prepared. The cosmos is aligning your
            personalized message.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh flex flex-col items-center justify-center px-6 cosmic-gradient overflow-hidden">
      {/* Stars */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 30 }, (_, i) => (
          <div
            key={i}
            className="star"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDuration: `${2 + Math.random() * 4}s`,
              animationDelay: `${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 text-center w-full max-w-md">
        <div className="cosmic-card rounded-3xl p-8 w-full">
          <div className="text-5xl mb-6">✦</div>
          <h2 className="text-2xl font-light text-white mb-3">
            Thank you, {quizData?.name || "Starseed"}!
          </h2>
          <p className="text-base text-gray-300/80 font-light leading-relaxed mb-6">
            Your Starseed Origin Reading is being prepared. Your{" "}
            <span className="text-gold font-medium">
              {quizData?.archetype ? archetypeStars[quizData.archetype as Archetype] : "cosmic"}
            </span>{" "}
            profile is being channeled into a full reading, voiced by Syrena, and
            on its way to you.
          </p>

          <div className="border-t border-white/5 pt-6 mt-2">
            <p className="text-sm text-gray-400/70 mb-2">
              ✦ What happens next
            </p>
            <ul className="text-xs text-gray-500/60 space-y-2 text-left">
              <li className="flex items-start gap-2">
                <span className="text-gold mt-0.5">✦</span>
                <span>Your full reading is being generated with AI</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold mt-0.5">✦</span>
                <span>Syrena's voice narration is being recorded</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold mt-0.5">✦</span>
                <span>Your shareable result card is being created</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold mt-0.5">✦</span>
                <span>Everything will arrive in your email shortly</span>
              </li>
            </ul>
          </div>
        </div>

        <button
          onClick={() => navigate({ to: "/" })}
          className="text-sm text-gray-500/60 hover:text-gray-400 transition-colors"
        >
          ← Return home
        </button>
      </div>
    </main>
  );
}
