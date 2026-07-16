import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

function Starfield({ count = 60 }: { count?: number }) {
  const stars = Array.from({ length: count }, (_, i) => ({
    id: i,
    size: Math.random() > 0.9 ? 3 : 2,
    top: Math.random() * 100,
    left: Math.random() * 100,
    duration: 2 + Math.random() * 4,
    delay: Math.random() * 5,
    bright: Math.random() > 0.9,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {stars.map((s) => (
        <div
          key={s.id}
          className={`star ${s.bright ? "star-bright" : ""}`}
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.opacity = "0";
      titleRef.current.style.transform = "translateY(20px)";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (titleRef.current) {
            titleRef.current.style.opacity = "1";
            titleRef.current.style.transform = "translateY(0)";
            titleRef.current.style.transition = "all 1s cubic-bezier(0.4, 0, 0.2, 1)";
          }
        });
      });
    }
  }, []);

  const handleStart = () => {
    navigate({ to: "/quiz" });
  };

  return (
    <main className="relative min-h-dvh flex flex-col items-center justify-center px-6 text-center cosmic-gradient overflow-hidden">
      <Starfield />

      {/* Decorative glow orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-violet-600/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[250px] h-[250px] rounded-full bg-indigo-600/8 blur-[100px] pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 max-w-lg flex flex-col items-center gap-8">
        <div className="flex flex-col gap-4">
          <h1
            ref={titleRef}
            className="text-3xl sm:text-4xl md:text-5xl font-light leading-tight tracking-tight text-white"
          >
            <span className="font-normal">
              You've always felt like you're not fully{" "}
            </span>
            <span className="text-gold font-light italic">from here</span>
            <span className="font-normal">.</span>
          </h1>

          <p className="text-base sm:text-lg text-gray-300/80 font-light leading-relaxed max-w-sm mx-auto">
            That quiet ache of never quite belonging — the sense that your home
            is somewhere among the stars — isn't a flaw. It's a clue.
          </p>
          <p className="text-sm text-gray-400/70 font-light max-w-xs mx-auto">
            Take the 2-minute Starseed Origin Quiz and discover which star
            system your energy carries.
          </p>
        </div>

        <button
          onClick={handleStart}
          className="glow-button px-10 py-4 rounded-2xl text-white font-medium text-lg tracking-wide transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          Discover Your Starseed Origin
        </button>

        <p className="text-xs text-gray-500/60 font-light">
          ✦ Personalized reading ✦ No account needed
        </p>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-6 z-10 text-xs text-gray-600/60 font-light">
        Syrena · The Origin Codex
      </footer>
    </main>
  );
}