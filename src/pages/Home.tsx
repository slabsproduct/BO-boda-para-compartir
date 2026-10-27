import React, { useEffect, useRef, useState } from "react";

interface HomeProps {
  onRsvpClick: () => void;
  onAdminClick?: () => void;
}

export const Home: React.FC<HomeProps> = ({ onRsvpClick, onAdminClick }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onRsvpClickRef = useRef(onRsvpClick);
  const [frameHeight, setFrameHeight] = useState(() => window.innerHeight);
  const [isLoading, setIsLoading] = useState(true);
  onRsvpClickRef.current = onRsvpClick;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const loadingStartedAt = Date.now();
    let preloadTimeout: number | undefined;
    let cleanupFrame: (() => void) | undefined;
    const handleLoad = () => {
      const childDocument = frame.contentDocument;
      const expectedPath = new URL(frame.src, window.location.href).pathname;
      if (!childDocument || childDocument.location.pathname !== expectedPath) return;

      cleanupFrame?.();

      const minimumLoadingTime = 1800;
      const remainingLoadingTime = Math.max(0, minimumLoadingTime - (Date.now() - loadingStartedAt));
      preloadTimeout = window.setTimeout(() => setIsLoading(false), remainingLoadingTime);

      childDocument.documentElement.lang = "es";
      childDocument.querySelectorAll("#__framer-badge-container, #__framer-editorbar-container, #__framer-editorbar")
        .forEach((element) => element.remove());

      const brandingStyles = childDocument.createElement("style");
      brandingStyles.textContent = `
        #__framer-badge-container, #__framer-editorbar-container, #__framer-editorbar { display: none !important; }
        .mobile-flip-hint {
          position: absolute;
          inset: 0;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 20px;
          border-radius: 4px;
          box-sizing: border-box;
          background: rgba(250, 246, 242, 0.62);
          color: #363B1F;
          font: 20px/1.2 'Melagu Regular', 'Instrument Serif', Georgia, serif;
          text-align: center;
          pointer-events: none;
          opacity: 0;
          transition: opacity 1s ease-in-out;
        }
        .mobile-flip-hint-visible { opacity: 1; }
        .mobile-flip-hint-hidden { opacity: 0; }
        .mobile-flip-hint-circle {
          display: block;
          width: 38px;
          height: 38px;
          border: 1.5px solid #6E0D23;
          border-radius: 50%;
          box-shadow: 0 0 0 0 rgba(110, 13, 35, 0.28);
          animation: mobile-flip-hint-pulse 1.6s ease-out infinite;
        }
        @keyframes mobile-flip-hint-pulse {
          0% { box-shadow: 0 0 0 0 rgba(110, 13, 35, 0.28); transform: scale(0.94); }
          70%, 100% { box-shadow: 0 0 0 10px rgba(110, 13, 35, 0); transform: scale(1); }
        }
        @media (min-width: 810px) { .mobile-flip-hint { display: none !important; } }
        @media (prefers-reduced-motion: reduce) {
          .mobile-flip-hint { transition: none; }
          .mobile-flip-hint-circle { animation: none; }
        }
      `;
      childDocument.head.appendChild(brandingStyles);

      const flipCardSelector = "#datos .framer-19orn2u-container, #datos .framer-18cyolp-container, #datos .framer-gvzoy3-container";
      const flipCardTimers = new Map<HTMLElement, number>();
      const flipHintRemovalTimers = new Set<number>();
      const observedFlipCards = new WeakSet<HTMLElement>();
      const childWindow = childDocument.defaultView;
      const mobileViewport = childWindow?.matchMedia("(max-width: 809.98px)");
      const fadeOutFlipHint = (card: HTMLElement) => {
        const hint = card.querySelector<HTMLElement>(".mobile-flip-hint");
        if (!hint || hint.classList.contains("mobile-flip-hint-hidden")) return;

        hint.classList.remove("mobile-flip-hint-visible");
        hint.classList.add("mobile-flip-hint-hidden");
        const removalTimer = window.setTimeout(() => {
          hint.remove();
          flipHintRemovalTimers.delete(removalTimer);
        }, 1000);
        flipHintRemovalTimers.add(removalTimer);
      };
      const flipCardObserver = new childWindow!.IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const card = entry.target as HTMLElement;
          const timer = flipCardTimers.get(card);

          if (!entry.isIntersecting || !mobileViewport?.matches || card.dataset.mobileFlipHintDismissed === "true") {
            if (timer !== undefined) {
              window.clearTimeout(timer);
              flipCardTimers.delete(card);
            }
            if (!mobileViewport?.matches) card.querySelector(".mobile-flip-hint")?.remove();
            else if (!entry.isIntersecting) fadeOutFlipHint(card);
            return;
          }

          if (timer !== undefined || card.querySelector(".mobile-flip-hint")) return;

          flipCardTimers.set(card, window.setTimeout(() => {
            flipCardTimers.delete(card);
            if (!mobileViewport.matches || !card.isConnected || card.dataset.mobileFlipHintDismissed === "true") return;

            const hint = childDocument.createElement("div");
            hint.className = "mobile-flip-hint";
            hint.setAttribute("aria-hidden", "true");
            hint.innerHTML = '<span class="mobile-flip-hint-circle"></span><span>Tocá para ver más</span>';
            card.appendChild(hint);
            childWindow!.requestAnimationFrame(() => hint.classList.add("mobile-flip-hint-visible"));
          }, 2000));
        });
      }, { threshold: 0.35 });
      const trackFlipCards = () => {
        childDocument.querySelectorAll<HTMLElement>(flipCardSelector).forEach((card) => {
          if (observedFlipCards.has(card)) return;
          observedFlipCards.add(card);
          flipCardObserver.observe(card);
        });
      };
      trackFlipCards();
      const flipCardMutationObserver = new MutationObserver(trackFlipCards);
      const cardsSection = childDocument.querySelector("#datos");
      if (cardsSection) flipCardMutationObserver.observe(cardsSection, { childList: true, subtree: true });

      const handleClick = (event: MouseEvent) => {
        const target = event.target as Element | null;
        const flipCard = target?.closest<HTMLElement>(flipCardSelector);
        if (flipCard) {
          flipCard.dataset.mobileFlipHintDismissed = "true";
          const timer = flipCardTimers.get(flipCard);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            flipCardTimers.delete(flipCard);
          }
          fadeOutFlipHint(flipCard);
        }

        const trigger = target?.closest(
          'a[data-framer-name="Standard Accent"], a[data-framer-name="Large Light"], a[data-framer-name="Standard Light"], a[href="#rsvp"], a[href*="bodamariysimon.online/form"], button[data-framer-name="Standard Accent"], [data-rsvp-trigger="true"]'
        );
        const text = target?.closest("a, button, [role='button']")?.textContent?.toLowerCase() || "";

        if (trigger || text.includes("confirmar asistencia") || text.includes("confirma tu asistencia") || text.includes("avisar en confirmación")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          onRsvpClickRef.current();
        }
      };

      childDocument.addEventListener("click", handleClick, true);

      const replaceWithGif = (selector: string, source: string, replaceVideo = false) => {
        childDocument.querySelectorAll<HTMLElement>(selector).forEach((container) => {
          let image = container.querySelector("img") as HTMLImageElement | null;
          const video = replaceVideo ? container.querySelector("video") as HTMLVideoElement | null : null;

          if (!image && video) {
            image = childDocument.createElement("img");
            image.alt = "";
            image.style.cssText = video.style.cssText;
            video.replaceWith(image);
          }

          if (!image) return;
          image.removeAttribute("srcset");
          image.removeAttribute("sizes");
          image.loading = "eager";
          if (image.getAttribute("src") !== source) image.setAttribute("src", source);
        });
      };
      const applyWeddingGifs = () => {
        replaceWithGif(
          ".framer-a4ob5c-container",
          "/assets/images/Couple_dancing_in_red_ink_20261024202145_alpha (1).gif?v=20261027-3",
          true
        );
        replaceWithGif(
          ".framer-11aifpr",
          "/assets/images/Characters_walking_with_dog_20261024202041_alpha.gif?v=20261027-3"
        );
      };
      const weddingGifObserver = new MutationObserver(applyWeddingGifs);
      weddingGifObserver.observe(childDocument.querySelector("#main") || childDocument.documentElement, {
        attributes: true,
        attributeFilter: ["poster", "src", "srcset", "sizes"],
        childList: true,
        subtree: true,
      });
      applyWeddingGifs();

      const countdownUnits = ["months", "days", "hours", "minutes", "seconds"];
      childDocument.querySelectorAll("span").forEach((label) => {
        const unit = label.textContent?.trim().toLowerCase();
        if (countdownUnits.includes(unit || "")) {
          const value = label.previousElementSibling as HTMLElement | null;
          if (value) value.dataset.cd = unit;
        }
      });
      const weddingDate = new Date("2027-04-03T15:30:00-03:00");
      const updateCountdown = () => {
        const totalSeconds = Math.floor((weddingDate.getTime() - Date.now()) / 1000);
        if (totalSeconds <= 0) return;

        const values = {
          months: Math.floor(totalSeconds / (3600 * 24 * 30)),
          days: Math.floor((totalSeconds % (3600 * 24 * 30)) / (3600 * 24)),
          hours: Math.floor((totalSeconds % (3600 * 24)) / 3600),
          minutes: Math.floor((totalSeconds % 3600) / 60),
          seconds: totalSeconds % 60,
        };
        Object.entries(values).forEach(([unit, value]) => {
          childDocument.querySelectorAll(`[data-cd="${unit}"]`).forEach((element) => {
            element.textContent = String(value).padStart(2, "0");
          });
        });
      };
      updateCountdown();
      const countdownTimer = window.setInterval(updateCountdown, 1000);

      const resizeFrame = () => {
        const height = Math.max(
          childDocument.documentElement.scrollHeight,
          childDocument.body?.scrollHeight || 0
        );
        setFrameHeight(height);
      };
      const resizeObserver = new ResizeObserver(resizeFrame);
      resizeObserver.observe(childDocument.documentElement);
      if (childDocument.body) resizeObserver.observe(childDocument.body);
      childDocument.querySelector("#main")?.addEventListener("transitionend", resizeFrame);
      window.addEventListener("resize", resizeFrame);

      let isSyncingScroll = false;
      const syncFrameScroll = () => {
        if (!childWindow || isSyncingScroll) return;
        isSyncingScroll = true;
        childWindow.scrollTo(0, window.scrollY);
        window.setTimeout(() => { isSyncingScroll = false; }, 50);
      };
      const syncPageScroll = () => {
        if (!childWindow || isSyncingScroll) return;
        isSyncingScroll = true;
        window.scrollTo(0, childWindow.scrollY);
        window.setTimeout(() => { isSyncingScroll = false; }, 50);
      };
      childWindow?.addEventListener("scroll", syncPageScroll, { passive: true });
      window.addEventListener("scroll", syncFrameScroll, { passive: true });
      resizeFrame();

      cleanupFrame = () => {
        window.clearInterval(countdownTimer);
        flipCardObserver.disconnect();
        flipCardMutationObserver.disconnect();
        flipCardTimers.forEach((timer) => window.clearTimeout(timer));
        flipHintRemovalTimers.forEach((timer) => window.clearTimeout(timer));
        weddingGifObserver.disconnect();
        childDocument.removeEventListener("click", handleClick, true);
        childDocument.querySelector("#main")?.removeEventListener("transitionend", resizeFrame);
        window.removeEventListener("resize", resizeFrame);
        window.removeEventListener("scroll", syncFrameScroll);
        childWindow?.removeEventListener("scroll", syncPageScroll);
        resizeObserver.disconnect();
      };
    };

    frame.addEventListener("load", handleLoad);
    if (
      frame.contentDocument?.readyState === "complete" &&
      frame.contentDocument.location.pathname === new URL(frame.src, window.location.href).pathname
    ) handleLoad();
    return () => {
      frame.removeEventListener("load", handleLoad);
      window.clearTimeout(preloadTimeout);
      cleanupFrame?.();
    };
  }, []);

  return (
    <div className="w-full" style={{ height: frameHeight }}>
      <div
        className={`home-preloader fixed inset-0 z-[60] flex items-center justify-center ${isLoading ? "home-preloader-visible" : "home-preloader-hidden"}`}
        role="status"
        aria-label="Cargando el sitio"
        aria-hidden={!isLoading}
      >
        <div className="home-preloader-emblem" aria-hidden="true">
          <span className="home-preloader-ring" />
          <img src="/favicon.svg" alt="" />
        </div>
      </div>
      <iframe
        ref={frameRef}
        src="/framer-home.html?revision=20261027-mobile-card-hint-iframe-window"
        title="Boda de Mari y Simón"
        className="fixed inset-x-0 top-0 z-40 block w-full border-0"
        style={{ height: "100vh" }}
      />
    </div>
  );
};
