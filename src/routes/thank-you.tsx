import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { archetypeStars, archetypeDescriptions, type Archetype } from "~/utils/scoring";
import { generateReading, generateAudio } from "~/utils/reading-generation";
import { sendReadingEmail } from "~/utils/email";
import { retrieveQuizSession } from "~/utils/quiz-session";

export const Route = createFileRoute("/thank-you")({
  component: ThankYouPage,
});

interface ThankYouSearch {
  session_id?: string;
}

interface QuizData {
  name: string;
  archetype: string;
  secondaryArchetype: string;
  sunSign: string;
  includeShadow: boolean;
  answers?: Record<string, unknown>;
}

function ThankYouPage() {
  const navigate = useNavigate();
  const { session_id } = useSearch({ from: Route.id }) as ThankYouSearch;
  const [phase, setPhase] = useState<"loading" | "generating" | "complete" | "error">("loading");
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [primaryReading, setPrimaryReading] = useState<string>("");
  const [shadowReading, setShadowReading] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailMessage, setEmailMessage] = useState("");
  const shareCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function startPipeline() {
      try {
        // Gate 2: Require Stripe session_id to be present
        // Without it, the user didn't complete payment — refuse to generate a reading
        if (!session_id) {
          console.log("No Stripe session_id found — payment not confirmed");
          setPhase("error");
          return;
        }

        console.log("Stripe session ID:", session_id);

        // Gate 1: Try to retrieve quiz data. Preferred path is server-side token
        // retrieval (requires DATABASE_URL). Fallback: read directly from sessionStorage.
        const token = sessionStorage.getItem("syrena_quiz_token");
        let data: QuizData | null = null;

        if (token) {
          // Try server-side retrieval using the one-time token
          try {
            const result = await retrieveQuizSession({ data: { token } });

            if (result.quizData) {
              data = result.quizData;
              setQuizData(data);
            } else {
              console.log("Quiz session retrieval failed:", result.error);
              // Fall through to sessionStorage fallback
            }
          } catch (err) {
            // Server-side retrieval failed (e.g. no database) — fall through to sessionStorage
            console.warn("retrieveQuizSession failed:", (err as Error).message);
          }
        }

        // Fallback: read quiz data directly from sessionStorage
        if (!data) {
          const stored = sessionStorage.getItem("syrena_quiz_data");
          if (stored) {
            try {
              data = JSON.parse(stored) as QuizData;
              setQuizData(data);
              console.log("Using sessionStorage fallback for quiz data");
            } catch {
              console.error("Failed to parse sessionStorage quiz data");
            }
          }
        }

        // If we still don't have data, show error
        if (!data) {
          setPhase("error");
          return;
        }

        // Phase 1: Show animation briefly
        await new Promise((r) => setTimeout(r, 2000));

        if (cancelled) return;
        setPhase("generating");

        if (data) {
          // Phase 2: Generate reading via Claude
          const readingResult = await generateReading({
            data: {
              name: data.name,
              primaryArchetype: data.archetype,
              sunSign: data.sunSign,
              includeShadow: data.includeShadow,
            },
          });

          if (cancelled) return;

          setPrimaryReading(readingResult.primaryReading);
          if (readingResult.shadowReading) {
            setShadowReading(readingResult.shadowReading);
          }

          // Phase 3: Generate audio
          let fullText = readingResult.primaryReading;
          if (readingResult.shadowReading) {
            // Add a deliberate pause between the two readings
            fullText += '\n\n...\n\n' + readingResult.shadowReading;
          }

          const audioResult = await generateAudio({
            data: { text: fullText },
          });

          if (cancelled) return;

          if (audioResult.audioUrl) {
            setAudioUrl(audioResult.audioUrl);
            setAudioReady(true);
          }

          // Clear the token and fallback data after successful reading generation
          sessionStorage.removeItem("syrena_quiz_token");
          sessionStorage.removeItem("syrena_quiz_data");

          setPhase("complete");
        } else {
          setPhase("error");
        }
      } catch (error) {
        console.error("Reading generation error:", error);
        if (!cancelled) setPhase("error");
      }
    }

    startPipeline();
    return () => { cancelled = true; };
  }, [session_id]);

  // Share functionality
  const handleShare = async () => {
    if (!quizData) return;

    const shareText = `✨ My Starseed Origin Reading: ${quizData.archetype} ✨\n\n"${archetypeDescriptions[quizData.archetype as Archetype]?.slice(0, 100) || ""}..."\n\nIf this resonates with you too, you're not alone.\n🔮 Syrena · The Origin Codex`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "My Starseed Origin Reading",
          text: shareText,
        });
      } else {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Fallback: just copy to clipboard
      try {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // ignore
      }
    }
  };

  // Email sending handler
  const handleSendEmail = async () => {
    if (!emailInput.trim() || !quizData || !primaryReading) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput.trim())) {
      setEmailMessage("Please enter a valid email address");
      setEmailStatus("error");
      return;
    }

    setEmailStatus("sending");
    setEmailMessage("");

    try {
      const result = await sendReadingEmail({
        data: {
          to: emailInput.trim(),
          name: quizData.name,
          primaryArchetype: quizData.archetype,
          readingText: primaryReading,
          shadowReadingText: shadowReading || undefined,
          audioUrl: audioUrl || undefined,
        },
      });

      setEmailStatus(result.sent ? "sent" : "error");
      setEmailMessage(result.message);
    } catch {
      setEmailStatus("error");
      setEmailMessage("We couldn't send the email right now. Please try again.");
    }
  };

  // ─── Stars background component ─────────────────────────────────────────
  const Stars = () => (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {Array.from({ length: 40 }, (_, i) => (
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
  );

  // ─── Loading Phase ─────────────────────────────────────────────────────
  if (phase === "loading" || phase === "generating") {
    const isGenerating = phase === "generating";
    return (
      <main className="relative min-h-dvh flex flex-col items-center justify-center px-6 cosmic-gradient overflow-hidden">
        <Stars />

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
            {isGenerating ? "Channeling your reading..." : "Payment confirmed..."}
          </h2>
          <p className="text-sm text-gray-400/60 max-w-xs">
            {isGenerating
              ? "Syrena is weaving your personalized message. The cosmos is speaking your name."
              : "Your reading is being prepared. The cosmos is aligning your personalized message."}
          </p>
          {isGenerating && (
            <div className="flex gap-1.5 mt-2">
              <span className="w-2 h-2 rounded-full bg-violet-500/60 animate-bounce" style={{ animationDelay: "0s" }} />
              <span className="w-2 h-2 rounded-full bg-violet-500/60 animate-bounce" style={{ animationDelay: "0.15s" }} />
              <span className="w-2 h-2 rounded-full bg-violet-500/60 animate-bounce" style={{ animationDelay: "0.3s" }} />
            </div>
          )}
        </div>
      </main>
    );
  }

  // ─── Error Phase ───────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <main className="relative min-h-dvh flex flex-col items-center justify-center px-6 cosmic-gradient overflow-hidden">
        <Stars />

        <div className="relative z-10 flex flex-col items-center gap-8 text-center w-full max-w-md">
          <div className="cosmic-card rounded-3xl p-8 w-full">
            <div className="text-5xl mb-6">✦</div>
            <h2 className="text-2xl font-light text-white mb-3">
              Payment not confirmed
            </h2>
            <p className="text-base text-gray-300/80 font-light leading-relaxed mb-6">
              We couldn't verify your payment for this reading. Please complete
              the quiz and payment to unlock your personalized Starseed Origin
              Reading.
            </p>
            <button
              onClick={() => {
                sessionStorage.removeItem("syrena_quiz_token");
                sessionStorage.removeItem("syrena_quiz_data");
                navigate({ to: "/quiz" });
              }}
              className="glow-button px-8 py-3 rounded-xl text-white font-medium cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              Take the quiz →
            </button>
          </div>

          <button
            onClick={() => {
              sessionStorage.removeItem("syrena_quiz_token");
              sessionStorage.removeItem("syrena_quiz_data");
              navigate({ to: "/" });
            }}
            className="text-sm text-gray-500/60 hover:text-gray-400 transition-colors"
          >
            ← Return home
          </button>
        </div>
      </main>
    );
  }

  // ─── Complete Phase ────────────────────────────────────────────────────
  const archetype = quizData?.archetype as Archetype | undefined;
  const starRef = archetype ? archetypeStars[archetype] : "";
  const archetypeDesc = archetype ? archetypeDescriptions[archetype] : "";

  return (
    <main className="relative min-h-dvh flex flex-col items-center px-4 py-12 cosmic-gradient overflow-hidden">
      <Stars />

      <div className="relative z-10 w-full max-w-lg flex flex-col gap-8">
        {/* Header */}
        <div className="text-center">
          <p className="text-xs text-gray-500/60 tracking-widest uppercase mb-2">
            ✦ Your Starseed Origin Reading ✦
          </p>
          <h1 className="text-2xl sm:text-3xl font-light text-white">
            {quizData?.name || "Starseed"}
          </h1>
          <p className="text-gold text-sm mt-1">
            {archetype} · {starRef}
          </p>
          {quizData?.sunSign && (
            <p className="text-xs text-gray-500/50 mt-0.5">
              Sun in {quizData.sunSign}
            </p>
          )}
        </div>

        {/* Main Reading Card */}
        <div className="cosmic-card rounded-3xl p-6 sm:p-8 w-full">
          <div className="prose prose-invert max-w-none">
            {primaryReading.split("\n").map((paragraph, i) => {
              const trimmed = paragraph.trim();
              if (!trimmed) return null;
              // Check if it's a header/sign-off
              if (trimmed.startsWith("Dear ") && trimmed.endsWith(",")) {
                return (
                  <p key={i} className="text-white font-medium mb-4 text-lg">
                    {trimmed}
                  </p>
                );
              }
              if (trimmed.startsWith("With") || trimmed.startsWith("✦")) {
                return (
                  <p key={i} className="text-gray-400/70 mt-6 text-sm italic">
                    {trimmed}
                  </p>
                );
              }
              return (
                <p key={i} className="text-gray-200/80 font-light leading-relaxed mb-4 text-sm sm:text-base">
                  {trimmed}
                </p>
              );
            })}
          </div>
        </div>

        {/* Shadow Origin Card */}
        {shadowReading && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
              <span className="text-xs text-violet-400/60 tracking-widest uppercase">Shadow Origin</span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
            </div>

            <div className="cosmic-card rounded-3xl p-6 sm:p-8 w-full border-violet-500/20">
              <div className="prose prose-invert max-w-none">
                {shadowReading.split("\n").map((paragraph, i) => {
                  const trimmed = paragraph.trim();
                  if (!trimmed) return null;
                  if (trimmed.startsWith("Your Hidden") || trimmed.startsWith("— Shadow")) {
                    return (
                      <p key={i} className="text-violet-300 font-medium mb-4 text-base">
                        {trimmed}
                      </p>
                    );
                  }
                  if (trimmed.startsWith("✦")) {
                    return (
                      <p key={i} className="text-gray-400/70 mt-6 text-sm italic">
                        {trimmed}
                      </p>
                    );
                  }
                  return (
                    <p key={i} className="text-gray-200/80 font-light leading-relaxed mb-4 text-sm sm:text-base">
                      {trimmed}
                    </p>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Audio Player */}
        <div className="cosmic-card rounded-3xl p-6 w-full">
          <p className="text-xs text-gray-400/60 tracking-wider mb-4 text-center">
            Hear your reading spoken to you by Syrena ✦
          </p>
          {audioUrl ? (
            <audio
              controls
              autoPlay
              className="w-full"
              style={{
                filter: "hue-rotate(240deg) brightness(1.2)",
              }}
            >
              <source src={audioUrl} type="audio/mpeg" />
              Your browser does not support the audio element.
            </audio>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500/60">
                🎧 Audio narration coming soon
              </p>
              <p className="text-xs text-gray-500/40 mt-1">
                Your written reading is ready above
              </p>
            </div>
          )}
        </div>

        {/* Branded Share Card */}
        <div
          ref={shareCardRef}
          className="cosmic-card rounded-3xl p-6 sm:p-8 w-full text-center"
        >
          {/* Card content */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600/30 to-gold/20 flex items-center justify-center border border-white/10">
              <span className="text-2xl">✦</span>
            </div>
            <p className="text-gold text-xl font-medium tracking-wide">
              {quizData?.archetype}
            </p>
            <p className="text-white/50 text-sm font-light max-w-xs leading-relaxed">
              "{archetypeDesc?.slice(0, 120)}..."
            </p>
            <div className="border-t border-white/5 pt-4 mt-2 w-full">
              <p className="text-xs text-gray-500/50 tracking-widest uppercase">
                Syrena · The Origin Codex
              </p>
            </div>
          </div>

          {/* Social proof line */}
          <p className="text-xs text-gray-500/40 mb-4 italic">
            If this resonates with you too, you're not alone.
          </p>

          {/* Share buttons */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleShare}
              className="glow-button px-6 py-3 rounded-xl text-white text-sm font-medium cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              {copied ? "✓ Copied!" : "📱 Share to Stories"}
            </button>
          </div>
        </div>

        {/* Email input & delivery */}
        <div className="cosmic-card rounded-3xl p-6 w-full">
          {emailStatus === "idle" || emailStatus === "error" ? (
            <>
              <p className="text-xs text-gray-400/60 tracking-wider mb-3 text-center">
                Where should we send your reading?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500/60 focus:outline-none focus:border-violet-500/50 transition-colors"
                  disabled={emailStatus === "sending"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendEmail();
                  }}
                />
                <button
                  onClick={handleSendEmail}
                  disabled={emailStatus === "sending" || !emailInput.trim()}
                  className="glow-button px-5 py-3 rounded-xl text-white text-sm font-medium cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {emailStatus === "sending" ? "Sending..." : "Send my reading"}
                </button>
              </div>
              {emailMessage && (
                <p className="text-xs text-red-400/70 mt-2 text-center">{emailMessage}</p>
              )}
            </>
          ) : emailStatus === "sending" ? (
            <div className="text-center py-3">
              <p className="text-sm text-gray-400/60">Sending your reading...</p>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-sm text-gold/80">{emailMessage}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center pb-8">
          <button
            onClick={() => {
              sessionStorage.removeItem("syrena_quiz_token");
              sessionStorage.removeItem("syrena_quiz_data");
              navigate({ to: "/" });
            }}
            className="text-sm text-gray-500/60 hover:text-gray-400 transition-colors"
          >
            ← Take the quiz again
          </button>
        </div>
      </div>
    </main>
  );
}
