import React, { useEffect, useRef, useState } from "react";
import { assetUrl, framerHomeUrl, rsvpViewUrl, rewriteLocalAssetUrl } from "../lib/base";

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
    let fallbackTimeout: number | undefined;
    let cleanupFrame: (() => void) | undefined;

    // El loader debe ocultarse solo cuando el iframe termino de CARGAR DE VERDAD
    // (recursos + hidratacion de Framer), no por un cronometro fijo.
    const hideLoaderAfterMinimum = () => {
      if (preloadTimeout) return; // ya programado
      const minimumLoadingTime = 1200;
      const remainingLoadingTime = Math.max(0, minimumLoadingTime - (Date.now() - loadingStartedAt));
      preloadTimeout = window.setTimeout(() => setIsLoading(false), remainingLoadingTime);
    };

    // Red de seguridad: si el evento "load" nunca llega (cache buster, error de red,
    // iframe bloqueado), ocultar el loader a los 8s para no tapar el sitio para siempre.
    fallbackTimeout = window.setTimeout(hideLoaderAfterMinimum, 8000);

    const handleLoad = () => {
      const childDocument = frame.contentDocument;
      const expectedPath = new URL(frame.src, window.location.href).pathname;
      if (!childDocument || childDocument.location.pathname !== expectedPath) return;
      const childWindow = childDocument.defaultView;
      if (!childWindow) return;

      const heroVideo = childDocument.querySelector<HTMLVideoElement>(
        ".framer-15p17nr-container video"
      );
      if (heroVideo) {
        heroVideo.autoplay = true;
        heroVideo.muted = true;
        heroVideo.loop = true;
        heroVideo.playsInline = true;
        heroVideo.preload = "auto";
        heroVideo.style.opacity = "1";
        heroVideo.style.visibility = "visible";
        heroVideo.style.zIndex = "1";
        void heroVideo.play().catch((error: unknown) => {
          console.warn("[home] No se pudo iniciar el video del hero.", {
            error,
            src: heroVideo.currentSrc || heroVideo.src,
            sourceAttribute: heroVideo.getAttribute("src"),
            readyState: heroVideo.readyState,
            networkState: heroVideo.networkState,
            mediaError: heroVideo.error?.message,
            mp4Support: heroVideo.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'),
          });
        });
      }

      cleanupFrame?.();

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
      const mobileViewport = childWindow.matchMedia("(max-width: 809.98px)");
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
      const isCardVisible = (card: HTMLElement) => {
        const bounds = card.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return false;
        const visibleWidth = Math.max(0, Math.min(bounds.right, childWindow.innerWidth) - Math.max(bounds.left, 0));
        const visibleHeight = Math.max(0, Math.min(bounds.bottom, childWindow.innerHeight) - Math.max(bounds.top, 0));
        return (visibleWidth * visibleHeight) / (bounds.width * bounds.height) >= 0.35;
      };
      const updateFlipCardHints = () => {
        childDocument.querySelectorAll<HTMLElement>(flipCardSelector).forEach((card) => {
          const pendingTimer = flipCardTimers.get(card);
          if (!mobileViewport.matches) {
            if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
            flipCardTimers.delete(card);
            card.querySelector(".mobile-flip-hint")?.remove();
            return;
          }

          if (!isCardVisible(card)) {
            if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
            flipCardTimers.delete(card);
            fadeOutFlipHint(card);
            return;
          }

          if (card.dataset.mobileFlipHintDismissed === "true" || pendingTimer !== undefined || card.querySelector(".mobile-flip-hint")) return;

          const timer = window.setTimeout(() => {
            flipCardTimers.delete(card);
            if (!mobileViewport.matches || !card.isConnected || card.dataset.mobileFlipHintDismissed === "true" || !isCardVisible(card)) return;

            const hint = childDocument.createElement("div");
            hint.className = "mobile-flip-hint";
            hint.setAttribute("aria-hidden", "true");
            hint.innerHTML = '<span class="mobile-flip-hint-circle"></span><span>Tocá para ver más</span>';
            card.appendChild(hint);
            childWindow.requestAnimationFrame(() => hint.classList.add("mobile-flip-hint-visible"));
          }, 2000);
          flipCardTimers.set(card, timer);
        });
      };
      const cardsSection = childDocument.querySelector("#datos");
      const flipCardMutationObserver = new childWindow.MutationObserver(updateFlipCardHints);
      if (cardsSection) flipCardMutationObserver.observe(cardsSection, { childList: true, subtree: true });
      childWindow.addEventListener("scroll", updateFlipCardHints, { passive: true });
      childWindow.addEventListener("resize", updateFlipCardHints);
      window.addEventListener("scroll", updateFlipCardHints, { passive: true });
      updateFlipCardHints();

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

        const isRsvpCta =
          trigger !== null ||
          text.includes("confirmar asistencia") ||
          text.includes("confirma tu asistencia") ||
          text.includes("avisar en confirmación");

        // Links externos de la exportación de Framer (Google Maps, Waze,
        // Instagram, Pinterest...) que NO son el CTA de RSVP: abrirlos siempre
        // en una pestaña nueva en lugar de navegar dentro del iframe (allí
        // provocaban errores locales tipo "Cannot GET /...").
        const anchor = target?.closest?.("a[href]");
        const anchorHref = anchor?.getAttribute("href") || "";
        if (!isRsvpCta && /^https?:\/\//i.test(anchorHref)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          window.open(anchorHref, "_blank", "noopener,noreferrer");
          return;
        }

        if (isRsvpCta) {
          event.preventDefault();
          event.stopImmediatePropagation();
          // El CTA de Framer apunta a la web externa bodamariysimon.online/form;
          // lo reorientamos SIEMPRE a la vista RSVP local (?view=rsvp). Así, si
          // el click llega antes de que la app haya enganchado el listener del
          // iframe (o si Framer re-hidrata el nodo), el navegador navega a la
          // propia app —que arranca en la vista RSVP— y no a un link ajeno ni a
          // una ruta inexistente del servidor local.
          try { window.location.href = rsvpViewUrl(); } catch { /* noop */ }
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
          assetUrl("/assets/images/Couple_dancing_in_red_ink_20261024202145_alpha (1).gif") + "?v=20261027-3",
          true
        );
        replaceWithGif(
          ".framer-11aifpr",
          assetUrl("/assets/images/Characters_walking_with_dog_20261024202041_alpha.gif") + "?v=20261027-3"
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
        const now = new Date();
        if (weddingDate.getTime() <= now.getTime()) return;

        // Descomposición calendario real: meses exactos + días/horas/min/seg restantes
        let months = (weddingDate.getFullYear() - now.getFullYear()) * 12 + (weddingDate.getMonth() - now.getMonth());
        const anchorFor = (monthOffset: number) => {
          // Ancla en el mismo día de "now" dentro del mes objetivo, recortado al último día de ese mes
          const targetMonthFirst = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
          const lastDayOfTarget = new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth() + 1, 0).getDate();
          const day = Math.min(now.getDate(), lastDayOfTarget);
          return new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth(), day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
        };
        let anchor = anchorFor(months);
        if (anchor.getTime() > weddingDate.getTime()) {
          months -= 1;
          anchor = anchorFor(months);
        }
        let days = 0;
        while (anchor.getTime() + (days + 1) * 86400000 <= weddingDate.getTime()) days += 1;
        const remainingMs = weddingDate.getTime() - anchor.getTime() - days * 86400000;

        const values = {
          months,
          days,
          hours: Math.floor(remainingMs / 3600000),
          minutes: Math.floor((remainingMs % 3600000) / 60000),
          seconds: Math.floor((remainingMs % 60000) / 1000),
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

      // El iframe cargo, pero Framer aun esta hidratando (carga ~3.2MB de modulos .mjs).
      // Esperar a que document.readyState sea "complete" DENTRO del iframe para ocultar
      // el loader; si ya lo esta, hideLoaderAfterMinimum() se programa de una.
      if (childDocument.readyState === "complete") {
        hideLoaderAfterMinimum();
      } else {
        childDocument.addEventListener("readystatechange", function onReady() {
          if (childDocument.readyState === "complete") {
            childDocument.removeEventListener("readystatechange", onReady);
            hideLoaderAfterMinimum();
          }
        });
      }

      cleanupFrame = () => {
        window.clearInterval(countdownTimer);
        flipCardMutationObserver.disconnect();
        flipCardTimers.forEach((timer) => window.clearTimeout(timer));
        flipHintRemovalTimers.forEach((timer) => window.clearTimeout(timer));
        childWindow.removeEventListener("scroll", updateFlipCardHints);
        childWindow.removeEventListener("resize", updateFlipCardHints);
        window.removeEventListener("scroll", updateFlipCardHints);
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
      window.clearTimeout(fallbackTimeout);
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
          <img src={assetUrl("/favicon.svg")} alt="" />
        </div>
      </div>
      <iframe
        ref={frameRef}
        src={framerHomeUrl()}
        title="Boda de Mari y Simón"
        className="fixed inset-x-0 top-0 z-40 block w-full border-0"
        style={{ height: "100vh" }}
      />
    </div>
  );
};
