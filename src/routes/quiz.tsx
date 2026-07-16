import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import { scoreQuiz, archetypeStars, type QuizAnswers } from "~/utils/scoring";

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
  | "reading"
  | "reveal";

interface FormState {
  name: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
  belonging: number | null;
  intensity: number | null;
  nightSky: number | null;
  dreams: number | null;
  recharge: number | null;
}

function QuizPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("name");
  const [form, setForm] = useState<FormState>({
    name: "",
    birthMonth: "",
    birthDay: "",
    birthYear: "",
    belonging: null,
    intensity: null,
    nightSky: null,
    dreams: null,
    recharge: null,
  });
  const [animating, setAnimating] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof scoreQuiz> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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
    if (form.name.trim()) transitionTo("birthdate");
  };

  const handleBirthdateSubmit = () => {
    if (form.birthMonth && form.birthDay) transitionTo("belonging");
  };

  const handleAnswer = (field: keyof FormState, value: number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    const stepOrder: Step[] = ["name", "birthdate", "belonging", "intensity", "nightSky", "dreams", "recharge", "reading", "reveal"];
    const currentIdx = stepOrder.indexOf(step);
    if (currentIdx < stepOrder.length - 1 && step !== "reading" && step !== "reveal") {
      setTimeout(() => transitionTo(stepOrder[currentIdx + 1]), 200);
    }
  };

  const handleSubmitQuiz = () => {
    if (
      form.belonging === null ||
      form.intensity === null ||
      form.nightSky === null ||
      form.dreams === null ||
      form.recharge === null
    )
      return;

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
      };
      const computed = scoreQuiz(answers);
      setResult(computed);
      transitionTo("reveal");
    }, 2500);
  };

  const handleUnlock = () => {
    console.log("Unlock reading clicked — placeholder for Stripe Checkout");
    // navigate({ to: "/checkout" }); // future
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
            const stepOrder: Step[] = ["name", "birthdate", "belonging", "intensity", "nightSky", "dreams", "recharge", "reading", "reveal"];
            const idx = stepOrder.indexOf(step);
            if (idx > 0) transitionTo(stepOrder[idx - 1]);
          }}
          className="absolute top-6 left-6 z-20 text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Back
        </button>
      )}

      <div className="relative z-10 w-full max-w-md" ref={contentRef}>
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
                {Array.from({ length: 60 }, (_, i) => (
                  <option key={i} value={1965 + i} className="bg-[#1a0533]">
                    {1965 + i}
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
                  className="w-full py-4 px-6 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-violet-600/20 hover:border-violet-500/40 transition-all text-left"
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
                  className="w-full py-4 px-6 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-violet-600/20 hover:border-violet-500/40 transition-all text-left"
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
                  className="w-full py-4 px-6 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-violet-600/20 hover:border-violet-500/40 transition-all text-left"
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
                  className="w-full py-4 px-6 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-violet-600/20 hover:border-violet-500/40 transition-all text-left"
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
                  onClick={() => {
                    setForm((p) => ({ ...p, recharge: opt.value }));
                    // Delay submission to show last answer
                    setTimeout(handleSubmitQuiz, 200);
                  }}
                  className="w-full py-4 px-6 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-violet-600/20 hover:border-violet-500/40 transition-all text-left"
                >
                  {opt.label}
                </button>
              ))}
            </div>
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

        {step === "reveal" && result && (
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

              <div className="blur-reveal relative overflow-hidden">
                <div className="filter blur-sm select-none">
                  <p className="text-sm text-white/50 font-light leading-relaxed">
                    The {result.primaryArchetype} frequency resonates within your
                    soul's core. This starseed lineage carries a unique signature
                    that shapes how you experience the world. Your sun in{" "}
                    {result.sunSign} adds a layer of cosmic texture that
                    influences your expression. The full reading reveals your
                    complete starseed profile, including your shadow origin and
                    the mission your soul chose before incarnating. This is only
                    the beginning of your remembrance.
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-white/5">
                <p className="text-xs text-gray-500/60 mb-1">
                  {result.secondaryArchetype} influence detected
                </p>
                <div className="flex justify-center gap-1.5 mt-3">
                  <span className="text-gold text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                  <span className="text-gray-500 text-xs">✦</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleUnlock}
              className="glow-button px-10 py-4 rounded-2xl text-white font-medium text-lg tracking-wide transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] cursor-pointer w-full max-w-xs"
            >
              Unlock Your Full Reading — $19
            </button>

            <button
              onClick={() => navigate({ to: "/" })}
              className="text-sm text-gray-500/60 hover:text-gray-400 transition-colors"
            >
              ← Take the quiz again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}