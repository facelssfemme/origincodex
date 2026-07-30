import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import { scoreQuiz, archetypeStars, archetypeDescriptions, type QuizAnswers, type Archetype } from "~/utils/scoring";
import { createCheckoutSession } from "~/utils/stripe-checkout";
import { saveQuizSession } from "~/utils/quiz-session";

export const Route = createFileRoute("/quiz")({
  component: QuizPage,
});

type Step =
  | "name"
  | "birthdate"
  | "belonging"
  | "intensity"
  | "nightSky"
  | "dreams"
  | "recharge"
  | "empathy"
  | "soulAge"
  | "email"
  | "reading"
  | "reveal";

interface FormState {
  name: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
  email: string;
  belonging: number | null;
  intensity: number | null;
  nightSky: number | null;
  dreams: number | null;
  recharge: number | null;
  empathy: number | null;
  soulAge: number | null;
}

function QuizPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("name");
  const [form, setForm] = useState<FormState>({
    name: "",
    birthMonth: "",
    birthDay: "",
    birthYear: "",
    email: "",
    belonging: null,
    intensity: null,
    nightSky: null,
    dreams: null,
    recharge: null,
    empathy: null,
    soulAge: null,
  });
  const [animating, setAnimating] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);
  const [addShadowOrigin, setAddShadowOrigin] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Progress bar: 10 steps (name → 7 trait questions → birthdate → email)
  const PROGRESS_STEPS: Step[] = [
    "name", "belonging", "intensity", "nightSky", "dreams",
    "recharge", "empathy", "soulAge", "birthdate", "email",
  ];
  const stepIndex = PROGRESS_STEPS.indexOf(step);
  const totalProgressSteps = PROGRESS_STEPS.length;
  const progressPct = stepIndex >= 0 ? Math.round((stepIndex / (totalProgressSteps - 1)) * 100) : 0;

  const transitionTo = useCallback((nextStep: Step) => {
    setAnimating(true);
    setTimeout(() => {
      setStep(nextStep);
      setAnimating(false);
    }, 300);
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.style.opacity = "0";
      contentRef.current.style.transform = "translateY(20px)";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.style.opacity = "1";
            contentRef.current.style.transform = "translateY(0)";
            contentRef.current.style.transition = "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)";
          }
        });
      });
    }
  }, [step]);

  const handleStart = () => transitionTo("name");

  const handleNameSubmit = () => {
    if (form.name.trim()) transitionTo("belonging");
  };

  const handleBirthdateSubmit = () => {
    if (!form.birthMonth || !form.birthDay) return;
    // All trait answers must be complete
    if (
      form.belonging === null ||
      form.intensity === null ||
      form.nightSky === null ||
      form.dreams === null ||
      form.recharge === null ||
      form.empathy === null ||
      form.soulAge === null
    )
      return;

    transitionTo("email");
  };

  const handleEmailContinue = () => {
    transitionTo("reading");

    // After 2.5 seconds, compute result and show reveal
    setTimeout(() => {
      const answers: QuizAnswers = {
        name: form.name,
        birthMonth: parseInt(form.birthMonth) || 1,
        birthDay: parseInt(form.birthDay) || 1,
        belonging: form.belonging!,
        intensity: form.intensity!,
        nightSky: form.nightSky!,
        dreams: form.dreams!,
        recharge: form.recharge!,
        empathy: form.empathy!,
        soulAge: form.soulAge!,
      };
      const computed = scoreQuiz(answers);
      setResult(computed);
      transitionTo("reveal");
    }, 2500);
  };

  const handleAnswer = (field: keyof FormState, value: number) => {
    if (animating) return; // Prevent double-clicks during transition
    setForm((prev) => ({ ...prev, [field]: value }));
    setSelectedAnswer(field);
    const stepOrder: Step[] = ["belonging", "intensity", "nightSky", "dreams", "recharge", "empathy", "soulAge"];
    const currentIdx = stepOrder.indexOf(step as typeof stepOrder[number]);
    if (currentIdx >= 0 && currentIdx < stepOrder.length - 1) {
      transitionTo(stepOrder[currentIdx + 1]);
    } else if (currentIdx === stepOrder.length - 1 || step === "soulAge") {
      // Last trait question → go to birthdate
      transitionTo("birthdate");
    }
  };

  const handleUnlock = async () => {
    if (!result) return;

    // Build quiz data payload
    const quizData = {
      name: form.name,
      email: form.email,
      archetype: result.primaryArchetype,
      secondaryArchetype: result.secondaryArchetype,
      sunSign: result.sunSign,
      includeShadow: addShadowOrigin,
      answers: {
        birthMonth: form.birthMonth,
        birthDay: form.birthDay,
        birthYear: form.birthYear,
        belonging: form.belonging,
        intensity: form.intensity,
        nightSky: form.nightSky,
        dreams: form.dreams,
        recharge: form.recharge,
        empathy: form.empathy,
        soulAge: form.soulAge,
      },
    };

    // Always store quiz data in sessionStorage as fallback
    // (survives same-tab redirects, cleared when tab closes)
    sessionStorage.setItem("syrena_quiz_data", JSON.stringify(quizData));

    try {
      // Save quiz data server-side and get a one-time token (requires DATABASE_URL)
      const { token } = await saveQuizSession({ data: quizData });

      // Store the token for server-side retrieval on thank-you page
      sessionStorage.setItem("syrena_quiz_token", token);
    } catch (error) {
      // Database not available — quiz data is already in sessionStorage as fallback.
      // This is expected when DATABASE_URL is not configured. The thank-you page
      // will use sessionStorage data directly when no token is present.
      console.warn("saveQuizSession failed (DB may not be connected), using sessionStorage fallback:", (error as Error).message);
    }

    try {
      // Redirect to Stripe checkout
      const { url } = await createCheckoutSession({ data: { includeShadow: addShadowOrigin } });
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("Checkout redirect error:", error);
    }
  };

  return (
    <main className="relative min-h-dvh flex flex-col items-center justify-center px-6 cosmic-gradient overflow-hidden">
      {/* Stars */}
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

      {/* Back button for early steps */}
      {step !== "reading" && step !== "reveal" && step !== "name" && (
        <button
          onClick={() => {
            const stepOrder: Step[] = ["belonging", "intensity", "nightSky", "dreams", "recharge", "empathy", "soulAge", "birthdate", "email"];
            const idx = stepOrder.indexOf(step as typeof stepOrder[number]);
            if (idx > 0) transitionTo(stepOrder[idx - 1]);
            else if (step === "belonging") transitionTo("name");
          }}
          className="absolute top-6 left-6 z-20 text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Back
        </button>
      )}

      <div className="relative z-10 w-full max-w-md" ref={contentRef}>
        {/* Progress bar — hidden on reading/reveal */}
        {step !== "reading" && step !== "reveal" && (
          <div className="mb-8 w-full">
            <div className="flex justify-between items-center gap-1 mb-2">
              {PROGRESS_STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                    i <= stepIndex
                      ? "bg-gradient-to-r from-violet-500 to-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.5)]"
                      : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <div className="flex justify-between px-0.5">
              <span className="text-[10px] text-gray-500/60">Start</span>
              <span className="text-[10px] text-gray-500/60">
                {stepIndex + 1} of {totalProgressSteps}
              </span>
            </div>
          </div>
        )}

        {step === "name" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white">
              What's your name?
            </h2>
            <p className="text-sm text-gray-400/80 -mt-4">
              Your reading will be spoken to you by name.
            </p>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
              placeholder="Enter your name..."
              className="w-full max-w-xs px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-center text-lg placeholder-gray-500/60 focus:outline-none focus:border-violet-500/50 transition-all"
              autoFocus
            />
            <button
              onClick={handleNameSubmit}
              disabled={!form.name.trim()}
              className="glow-button px-8 py-3 rounded-xl text-white font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Continue →
            </button>
          </div>
        )}

        {step === "birthdate" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white">
              What's your birth date?
            </h2>
            <p className="text-sm text-gray-400/80 -mt-4">
              Your sun sign adds cosmic flavor to your reading.
            </p>
            <div className="flex gap-3 w-full max-w-xs justify-center">
              <select
                value={form.birthMonth}
                onChange={(e) => setForm((p) => ({ ...p, birthMonth: e.target.value }))}
                className="flex-1 px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-center focus:outline-none focus:border-violet-500/50 transition-all appearance-none"
              >
                <option value="" className="bg-[#1a0533]">Month</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1} className="bg-[#1a0533]">
                    {[
                      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
                    ][i]}
                  </option>
                ))}
              </select>
              <select
                value={form.birthDay}
                onChange={(e) => setForm((p) => ({ ...p, birthDay: e.target.value }))}
                className="flex-1 px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-center focus:outline-none focus:border-violet-500/50 transition-all appearance-none"
              >
                <option value="" className="bg-[#1a0533]">Day</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1} className="bg-[#1a0533]">
                    {i + 1}
                  </option>
                ))}
              </select>
              <select
                value={form.birthYear}
                onChange={(e) => setForm((p) => ({ ...p, birthYear: e.target.value }))}
                className="flex-1 px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-center focus:outline-none focus:border-violet-500/50 transition-all appearance-none"
              >
                <option value="" className="bg-[#1a0533]">Year</option>
                {Array.from({ length: 95 }, (_, i) => (
                  <option key={i} value={1930 + i} className="bg-[#1a0533]">
                    {1930 + i}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleBirthdateSubmit}
              disabled={!form.birthMonth || !form.birthDay}
              className="glow-button px-8 py-3 rounded-xl text-white font-medium cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Continue →
            </button>
          </div>
        )}

        {step === "belonging" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              Do you feel like you don't<br />fully belong here?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "Yes — always have", value: 0 },
                { label: "Sometimes", value: 1 },
                { label: "No, I feel grounded here", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("belonging", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "belonging" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "intensity" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              Have you been called "intense"<br />without meaning to be?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "Often — my energy is strong", value: 0 },
                { label: "Rarely", value: 1 },
                { label: "Never — I'm very chill", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("intensity", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "intensity" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "nightSky" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              When you look at the night sky,<br />how does it feel?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "Deeply at home — I feel a pull", value: 0 },
                { label: "Curious but distant", value: 1 },
                { label: "Awestruck but small", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("nightSky", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "nightSky" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "dreams" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              Do you have vivid or<br />prophetic dreams?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "All the time — they feel real", value: 0 },
                { label: "Occasionally", value: 1 },
                { label: "Rarely or never", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("dreams", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "dreams" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "recharge" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              How do you best recharge?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "Being alone in nature", value: 0 },
                { label: "Being with close people", value: 1 },
                { label: "Creative flow — music, art, writing", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("recharge", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "recharge" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "empathy" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              How do you experience<br />other people's emotions?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "I feel them as if they're my own", value: 0 },
                { label: "I sense them but can keep distance", value: 1 },
                { label: "I'm usually focused on my own energy", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("empathy", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "empathy" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "soulAge" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white leading-snug">
              Do you feel like your soul<br />is older than your body?
            </h2>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {[
                { label: "Yes — I've always felt ancient", value: 0 },
                { label: "Sometimes — I feel wise beyond my years", value: 1 },
                { label: "No — I feel my age", value: 2 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer("soulAge", opt.value)}
                  disabled={animating}
                  className={`w-full py-4 px-6 rounded-xl bg-white/5 border text-white/80 transition-all text-left ${
                    animating
                      ? "border-white/5 opacity-50 cursor-not-allowed"
                      : "border-white/10 hover:bg-violet-600/20 hover:border-violet-500/40 cursor-pointer"
                  } ${selectedAnswer === "soulAge" ? "border-violet-500/60 bg-violet-600/20" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "email" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-light text-white">
              Want your results emailed to you?
            </h2>
            <p className="text-sm text-gray-400/80 -mt-4">
              Enter your email and we'll send your full reading there too.
            </p>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleEmailContinue()}
              placeholder="your@email.com"
              className="w-full max-w-xs px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-center text-lg placeholder-gray-500/60 focus:outline-none focus:border-violet-500/50 transition-all"
              autoFocus
            />
            <button
              onClick={handleEmailContinue}
              className="glow-button px-8 py-3 rounded-xl text-white font-medium cursor-pointer transition-all"
            >
              Continue →
            </button>
            <button
              onClick={handleEmailContinue}
              className="text-sm text-gray-500/50 hover:text-gray-400 transition-colors"
            >
              Skip
            </button>
          </div>
        )}

        {step === "reading" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <div className="relative w-24 h-24 mb-4">
              <div className="absolute inset-0 rounded-full bg-violet-600/20 swirl-ring" />
              <div className="absolute inset-2 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: "2s" }} />
              <div className="absolute inset-4 rounded-full bg-gold/20 reading-animation" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl">✦</span>
              </div>
            </div>
            <h2 className="text-2xl font-light text-white">
              Reading your energy...
            </h2>
            <p className="text-sm text-gray-400/60">
              Connecting to the cosmos for{" "}
              <span className="text-gold">{form.name}</span>
            </p>
          </div>
        )}

        {step === "reveal" && result && (() => {
            const fullDesc = archetypeDescriptions[result.primaryArchetype] || "";
            const firstSentence = fullDesc.split(". ")[0] + ".";
            const restOfReading = fullDesc.slice(firstSentence.length).trim();

            return (
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="cosmic-card rounded-3xl p-8 w-full">
              <p className="text-sm text-gray-400/70 mb-2">
                ✦ Your Starseed Reading ✦
              </p>

              <p className="text-base sm:text-lg text-white/70 font-light leading-relaxed mb-6">
                Your energy signature carries traces of{" "}
                <span className="text-gold font-medium">
                  {archetypeStars[result.primaryArchetype]}
                </span>
                ...
              </p>

              {/* First sentence visible — teaser */}
              <p className="text-sm text-white/80 font-light leading-relaxed mb-4 italic">
                {firstSentence}
              </p>

              {/* Rest blurred */}
              {restOfReading && (
                <div className="blur-reveal relative overflow-hidden">
                  <div className="filter blur-sm select-none">
                    <p className="text-sm text-white/50 font-light leading-relaxed">
                      {restOfReading} The full reading reveals your complete
                      starseed profile, including your shadow origin and the
                      mission your soul chose before incarnating. This is only the
                      beginning of your remembrance.
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-white/5">
                <p className="text-xs text-gray-500/60 mb-1">
                  {result.primaryArchetype} resonance confirmed
                </p>
                <div className="flex justify-center gap-1.5 mt-3">
                  <span className="text-gold text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                </div>
              </div>

              {/* Order-bump checkbox */}
              <label className="flex items-start gap-3 mt-6 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] cursor-pointer hover:bg-violet-600/10 hover:border-violet-500/30 transition-all text-left group">
                <input
                  type="checkbox"
                  checked={addShadowOrigin}
                  onChange={(e) => setAddShadowOrigin(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded-md border-2 border-gray-500/40 bg-transparent appearance-none checked:bg-violet-600 checked:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all flex-shrink-0 relative
                    checked:after:content-['✓'] checked:after:text-white checked:after:text-xs checked:after:font-bold checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-white/70 group-hover:text-white/90 transition-colors">
                    ✨ Unlock your <span className="text-gold">Shadow Origin</span> — the part of your energy you're hiding from — for <span className="text-white font-medium">$12</span> more
                  </span>
                  <span className="text-xs text-gray-500/50">
                    Reveal the hidden archetype your soul carries in shadow
                  </span>
                </div>
              </label>
            </div>

            <button
              onClick={handleUnlock}
              className="glow-button px-10 py-4 rounded-2xl text-white font-medium text-lg tracking-wide transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] cursor-pointer w-full max-w-xs"
            >
              Unlock Your Full Reading — ${addShadowOrigin ? "31" : "19"}
            </button>
          </div>
            );
          })()}
      </div>
    </main>
  );
}