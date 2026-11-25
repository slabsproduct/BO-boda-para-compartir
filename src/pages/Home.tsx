import React, { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  assetUrl,
  framerHomeUrl,
  resolveHeroDevice,
  rsvpViewUrl,
} from "../lib/base";

interface HomeProps {
  onRsvpClick: () => void;
}

export const Home: React.FC<HomeProps> = ({ onRsvpClick }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const audioEnabledRef = useRef(false);
  const onRsvpClickRef = useRef(onRsvpClick);
  const [heroDevice] = useState(resolveHeroDevice);
  const [frameHeight, setFrameHeight] = useState(() => window.innerHeight);
  const [isLoading, setIsLoading] = useState(true);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [musicPlaybackError, setMusicPlaybackError] = useState(false);
  onRsvpClickRef.current = onRsvpClick;

  const toggleMusic = async () => {
    const video = heroVideoRef.current;
    if (!video) return;
    setMusicPlaybackError(false);
    const enableAudio = video.muted;
    video.muted = !enableAudio;
    audioEnabledRef.current = enableAudio;
    setIsMusicPlaying(enableAudio);
    if (enableAudio && video.paused) {
      try {
        await video.play();
      } catch (error) {
        video.muted = true;
        audioEnabledRef.current = false;
        setIsMusicPlaying(false);
        console.error("[home] No se pudo activar el audio sincronizado del video.", error);
        setMusicPlaybackError(true);
      }
    }
  };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const frameDevice = new URL(frame.src, window.location.href).searchParams.get("device");
    if (frameDevice !== "mobile" && frameDevice !== "desktop") {
      throw new Error("[home] El iframe no recibió un perfil de dispositivo válido.");
    }

    document.documentElement.classList.add("home-scrollbar-hidden");
    const loadingStartedAt = Date.now();
    let preloadTimeout: number | undefined;
    let fallbackTimeout: number | undefined;
    let heroVideoStartTimeout: number | undefined;
    let hydrationWaitDocument: Document | undefined;
    let hydrationReadyListener: (() => void) | undefined;
    let cleanupFrame: (() => void) | undefined;
    let refreshHeroVideoAfterLoader: (() => void) | undefined;
    let iframeLoaded = false;
    let hideLoaderScheduled = false;
    let loaderFinished = false;

    const finishLoading = () => {
      if (loaderFinished) return;
      loaderFinished = true;
      setIsLoading(false);
      startHeroVideoAfterLoader();
    };

    const startHeroVideoAfterLoader = () => {
      window.clearTimeout(heroVideoStartTimeout);
      heroVideoStartTimeout = window.setTimeout(() => {
        refreshHeroVideoAfterLoader?.();
      }, 400);
    };

    const hideLoaderWhenReady = () => {
      if (!iframeLoaded || hideLoaderScheduled) return;
      hideLoaderScheduled = true;
      const minimumLoadingTime = 1800;
      const remainingLoadingTime = Math.max(0, minimumLoadingTime - (Date.now() - loadingStartedAt));
      preloadTimeout = window.setTimeout(() => {
        window.clearTimeout(fallbackTimeout);
        finishLoading();
      }, remainingLoadingTime);
    };

    fallbackTimeout = window.setTimeout(() => {
      console.warn("[home] Se agotó la espera máxima de carga; se ocultará el preloader.");
      finishLoading();
    }, 60000);

    const handleLoad = () => {
      const childDocument = frame.contentDocument;
      const expectedPath = new URL(frame.src, window.location.href).pathname;
      if (!childDocument || childDocument.location.pathname !== expectedPath) return;
      const childWindow = childDocument.defaultView;
      if (!childWindow) return;

      if (childDocument.documentElement.dataset.framerHydrated !== "true") {
        if (hydrationReadyListener) return;
        hydrationWaitDocument = childDocument;
        hydrationReadyListener = () => {
          hydrationReadyListener = undefined;
          hydrationWaitDocument = undefined;
          handleLoad();
        };
        childDocument.addEventListener("framer:hydrated", hydrationReadyListener, { once: true });
        return;
      }

      cleanupFrame?.();

      let scrollbarStyles = childDocument.querySelector<HTMLStyleElement>(
        "#home-scrollbar-hidden-styles"
      );
      if (!scrollbarStyles) {
        scrollbarStyles = childDocument.createElement("style");
        scrollbarStyles.id = "home-scrollbar-hidden-styles";
        scrollbarStyles.textContent = `
          @media (min-width: 1101px) {
            html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
            html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; width: 0 !important; }
          }
        `;
        childDocument.head.appendChild(scrollbarStyles);
      }
      let mobileContactStyles = childDocument.querySelector<HTMLStyleElement>(
        "#home-mobile-contact-styles"
      );
      if (!mobileContactStyles) {
        mobileContactStyles = childDocument.createElement("style");
        mobileContactStyles.id = "home-mobile-contact-styles";
        mobileContactStyles.textContent = `
          #home-mobile-contact-section { display: none; }
          @media (max-width: 1100px) {
            #home-mobile-contact-section {
              display: flex !important;
              flex-direction: column;
              align-items: center;
              gap: 14px;
              margin: 24px 20px 36px;
              padding: 24px 18px;
              border-radius: 20px;
              background: #f1ebe3;
              color: #363b1f;
              text-align: center;
            }
            #home-mobile-contact-section p {
              margin: 0;
              font: 500 18px/1.35 Inter, sans-serif;
            }
            #home-mobile-contact-section a {
              display: inline-flex;
              min-height: 44px;
              align-items: center;
              justify-content: center;
              padding: 0 22px;
              border-radius: 999px;
              background: #363b1f;
              color: #fff;
              font: 600 14px/1 Manrope, sans-serif;
              text-decoration: none;
            }
          }
        `;
        childDocument.head.appendChild(mobileContactStyles);
      }

      const faqSection = childDocument.querySelector<HTMLElement>("#faq");
      if (faqSection && !childDocument.querySelector("#home-mobile-contact-section")) {
        const contactSection = childDocument.createElement("div");
        contactSection.id = "home-mobile-contact-section";
        const contactMessage = childDocument.createElement("p");
        contactMessage.textContent = "¿Tienes más dudas?";
        const contactButton = childDocument.createElement("a");
        contactButton.href = `https://wa.me/5491176387793?text=${encodeURIComponent(
          "Hola Mari y Simon tengo la siguiente duda."
        )}`;
        contactButton.target = "_blank";
        contactButton.rel = "noopener noreferrer";
        contactButton.textContent = "Contáctanos al WhatsApp";
        contactSection.append(contactMessage, contactButton);
        faqSection.appendChild(contactSection);
      }
      let lottieLoaderStyles = childDocument.querySelector<HTMLStyleElement>(
        "#home-lottie-loader-styles"
      );
      if (!lottieLoaderStyles) {
        lottieLoaderStyles = childDocument.createElement("style");
        lottieLoaderStyles.id = "home-lottie-loader-styles";
        lottieLoaderStyles.textContent = `
          .home-lottie-loader {
            position: absolute;
            inset: 0;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: #363b1f;
            background: rgba(250, 246, 242, 0.68);
            font: 500 14px/1.3 Inter, sans-serif;
            pointer-events: none;
          }
          .home-lottie-loader-spinner {
            width: 30px;
            height: 30px;
            border: 3px solid rgba(54, 59, 31, 0.2);
            border-top-color: #6e0d23;
            border-radius: 50%;
            animation: home-lottie-loader-spin 800ms linear infinite;
          }
          @keyframes home-lottie-loader-spin {
            to { transform: rotate(360deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .home-lottie-loader-spinner { animation: none; }
          }
        `;
        childDocument.head.appendChild(lottieLoaderStyles);
      }
      let removeHeroViewportListener: (() => void) | undefined;
      const heroVideo = childDocument.querySelector<HTMLVideoElement>(
        ".framer-15p17nr-container video"
      );
      if (heroVideo) {
        heroVideoRef.current = heroVideo;
        const desktopSource = `${assetUrl("/assets/misc/desktop-hero.mp4")}?v=20261104-desktop-12`;
        const mobileSource = `${assetUrl("/assets/misc/mobile-hero.mp4")}?v=20261104-mobile-12`;
        const selectedSource = frameDevice === "mobile" ? mobileSource : desktopSource;
        let heroVideoStarted = false;
        heroVideo.dataset.homeHeroDevice = frameDevice;
        const videoContainer = heroVideo.parentElement;
        if (!videoContainer) {
          throw new Error("[home] No se encontró el contenedor del video del hero.");
        }
        videoContainer.style.position = "relative";
        videoContainer.style.overflow = "hidden";

        let responsiveStyles = childDocument.querySelector<HTMLStyleElement>(
          "#home-responsive-hero-video-styles"
        );
        if (!responsiveStyles) {
          responsiveStyles = childDocument.createElement("style");
          responsiveStyles.id = "home-responsive-hero-video-styles";
          responsiveStyles.textContent = `
              @media (min-width: 1101px) {
                .framer-oargH .framer-15p17nr-container video {
                  -webkit-mask-image:
                    linear-gradient(to right, transparent, #000 10px, #000 calc(100% - 10px), transparent),
                    linear-gradient(to bottom, transparent, #000 10px, #000 calc(100% - 10px), transparent);
                  -webkit-mask-composite: source-in;
                  mask-image:
                    linear-gradient(to right, transparent, #000 10px, #000 calc(100% - 10px), transparent),
                    linear-gradient(to bottom, transparent, #000 10px, #000 calc(100% - 10px), transparent);
                  mask-composite: intersect;
                }
              }
              .home-mobile-hero-video .framer-ZMBes {
                width: 100% !important;
                overflow-x: clip;
            }
            .home-mobile-hero-video .framer-oargH .framer-n19xkw {
              top: 100px !important;
              bottom: auto !important;
              left: 50% !important;
              width: min(600px, calc(100% - 32px)) !important;
              max-width: calc(100% - 32px) !important;
              height: auto !important;
              aspect-ratio: 1 / 1 !important;
              transform: translateX(-50%) !important;
              overflow: hidden;
            }
            .home-mobile-hero-video .framer-oargH .framer-15p17nr-container {
              position: absolute !important;
              inset: 0 !important;
              width: 100% !important;
              height: 100% !important;
              aspect-ratio: 1 / 1 !important;
            }
            .home-mobile-hero-video .framer-oargH .framer-15p17nr-container video {
              width: 100% !important;
              height: 100% !important;
              object-fit: contain !important;
              object-position: center !important;
              background: transparent !important;
              -webkit-mask-image: linear-gradient(
                to right,
                transparent 0,
                #000 4px,
                #000 calc(100% - 4px),
                transparent 100%
              );
              mask-image: linear-gradient(
                to right,
                transparent 0,
                #000 4px,
                #000 calc(100% - 4px),
                transparent 100%
              );
            }
          `;
          childDocument.head.appendChild(responsiveStyles);
        }

        heroVideo.removeAttribute("src");
        heroVideo.preload = "none";
        heroVideo.load();
        heroVideo.style.opacity = "0";
        heroVideo.autoplay = true;
        heroVideo.muted = true;
        heroVideo.loop = true;
        heroVideo.playsInline = true;
        heroVideo.style.visibility = "visible";
        heroVideo.style.zIndex = "1";
        heroVideo.style.position = "relative";
        heroVideo.style.transition = "opacity 450ms ease";
        heroVideo.style.objectFit = "cover";
        let heroLoadCancelled = false;
        let heroVideoLoadTimeout: number | undefined;
        let heroSourceAttempt = 0;
        const isCurrentHeroSource = () => {
          const expectedSource = heroVideo.dataset.homeHeroSource;
          const currentSource = heroVideo.currentSrc || heroVideo.src;
          if (!expectedSource || !currentSource) return false;
          return new URL(currentSource).pathname ===
            new URL(expectedSource, childDocument.baseURI).pathname;
        };
        const revealLoadedHeroVideo = () => {
          if (
            !heroLoadCancelled &&
            isCurrentHeroSource() &&
            heroVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            heroVideo.videoWidth > 0 &&
            heroVideo.videoHeight > 0
          ) {
            window.clearTimeout(heroVideoLoadTimeout);
            heroVideo.style.opacity = "1";
          }
        };
        const loadHeroVideoSource = (source: string, attempt: number) => {
          window.clearTimeout(heroVideoLoadTimeout);
          heroSourceAttempt = attempt;
          heroVideo.style.opacity = "0";
          heroVideo.pause();
          heroVideo.removeAttribute("src");
          heroVideo.load();
          heroVideo.dataset.homeHeroSource = source;
          heroVideo.preload = "auto";
          heroVideo.removeAttribute("fetchpriority");
          const requestUrl = new URL(source, childDocument.baseURI);
          if (attempt > 0) requestUrl.searchParams.set("hero-retry", String(attempt));
          heroVideo.src = requestUrl.href;
          heroVideo.load();
          heroVideoLoadTimeout = window.setTimeout(() => {
            if (heroLoadCancelled || !isCurrentHeroSource()) return;
            if (
              heroVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              heroVideo.videoWidth > 0 &&
              heroVideo.videoHeight > 0
            ) {
              revealLoadedHeroVideo();
              return;
            }
            handleHeroVideoFailure(source, attempt, "timeout");
          }, frameDevice === "desktop" ? 20000 : 12000);
          void heroVideo.play().catch((error: unknown) => {
            if (!heroLoadCancelled && isCurrentHeroSource()) {
              console.warn("[home] El navegador no inició la reproducción automática del video.", {
                error,
                src: heroVideo.currentSrc || heroVideo.src,
              });
            }
          });
        };
        const handleHeroVideoFailure = (source: string, attempt: number, reason: string) => {
          if (heroLoadCancelled || !isCurrentHeroSource()) return;
          window.clearTimeout(heroVideoLoadTimeout);
          if (attempt < 1) {
            console.warn("[home] El video del hero no quedó listo; se reintentará una vez.", {
              reason,
              src: heroVideo.currentSrc || heroVideo.src,
              mediaError: heroVideo.error?.message,
            });
            loadHeroVideoSource(source, attempt + 1);
            return;
          }
          console.warn("[home] No se pudo cargar el video del hero tras un reintento.", {
            reason,
            src: heroVideo.currentSrc || heroVideo.src,
            mediaError: heroVideo.error?.message,
          });
        };
        const reportHeroVideoError = () => {
          if (!heroLoadCancelled && isCurrentHeroSource()) {
            const source = heroVideo.dataset.homeHeroSource;
            if (source) handleHeroVideoFailure(source, heroSourceAttempt, "media-error");
          }
        };
        heroVideo.addEventListener("loadeddata", revealLoadedHeroVideo);
        heroVideo.addEventListener("canplay", revealLoadedHeroVideo);
        heroVideo.addEventListener("playing", revealLoadedHeroVideo);
        heroVideo.addEventListener("error", reportHeroVideoError);
        const updateHeroVideoSource = () => {
          const isMobile = frameDevice === "mobile";
          childDocument.documentElement.classList.toggle("home-mobile-hero-video", isMobile);
          const expectedPath = new URL(selectedSource, childDocument.baseURI).pathname;
          const currentSource = heroVideo.currentSrc || heroVideo.src;
          const currentPath = currentSource ? new URL(currentSource, childDocument.baseURI).pathname : "";
          if (
            heroVideoStarted &&
            heroVideo.dataset.homeHeroSource === selectedSource &&
            currentPath === expectedPath &&
            !heroVideo.error
          ) return;

          heroVideoStarted = true;
          heroVideo.muted = !audioEnabledRef.current;
          delete heroVideo.dataset.homeHeroSource;
          loadHeroVideoSource(selectedSource, 0);
        };
        refreshHeroVideoAfterLoader = () => {
          updateHeroVideoSource();
        };
        if (loaderFinished) startHeroVideoAfterLoader();
        removeHeroViewportListener = () => {
          heroLoadCancelled = true;
          window.clearTimeout(heroVideoLoadTimeout);
          heroVideo.removeEventListener("loadeddata", revealLoadedHeroVideo);
          heroVideo.removeEventListener("canplay", revealLoadedHeroVideo);
          heroVideo.removeEventListener("playing", revealLoadedHeroVideo);
          heroVideo.removeEventListener("error", reportHeroVideoError);
          childDocument.documentElement.classList.remove("home-mobile-hero-video");
        };
      }

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
        @media (min-width: 1101px) { .mobile-flip-hint { display: none !important; } }
        @media (prefers-reduced-motion: reduce) {
          .mobile-flip-hint { transition: none; }
          .mobile-flip-hint-circle { animation: none; }
        }
      `;
      childDocument.head.appendChild(brandingStyles);

      const flipCardSelector = "#datos .framer-19orn2u-container, #datos .framer-18cyolp-container, #datos .framer-gvzoy3-container";
      const flipCardTimers = new Map<HTMLElement, number>();
      const flipHintRemovalTimers = new Set<number>();
      const mobileViewport = childWindow.matchMedia("(max-width: 1100px)");
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

      const responsiveWeddingPhotos: Record<string, readonly number[]> = {
        "e46xCRfHepgef7YkuKzfZPZnCDY.jpg": [480, 768, 1280],
        "QAKwxgTNTfzEKEe982NwhbBNEgU.jpg": [480, 768, 1280],
        "CHtE3OgJcP9n0TFXZFlZ26TPQo.jpg": [480, 768, 1280],
      };
      const weddingPhotoSizes = "(max-width: 1100px) 90vw, (max-width: 1199px) 45vw, 600px";
      const applyResponsiveWeddingPhotos = () => {
        childDocument.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
          const source = image.getAttribute("src") || "";
          const filename = source.split(/[?#]/, 1)[0].split("/").pop() || "";
          const widths = responsiveWeddingPhotos[filename];
          if (!widths) return;

          const srcset = widths
            .map((width) => {
              const variant = filename.replace(/\.jpg$/, `-${width}.jpg`);
              return `${assetUrl(`/assets/images/${variant}`)} ${width}w`;
            })
            .join(", ");
          if (image.getAttribute("srcset") !== srcset) image.setAttribute("srcset", srcset);
          if (image.getAttribute("sizes") !== weddingPhotoSizes) image.setAttribute("sizes", weddingPhotoSizes);
        });
      };

      const replaceWithGif = (
        selector: string,
        source: string,
        srcset: string,
        sizes: string,
        replaceVideo = false
      ) => {
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
          image.loading = "lazy";
          image.decoding = "async";
          if (image.getAttribute("src") !== source) image.setAttribute("src", source);
          if (image.getAttribute("srcset") !== srcset) image.setAttribute("srcset", srcset);
          if (image.getAttribute("sizes") !== sizes) image.setAttribute("sizes", sizes);
        });
      };
      const gifCandidates = (filename: string, widths: readonly number[]) =>
        widths
          .map((width) => {
            const path = `/assets/images/${filename}-${width}.gif`;
            return `${encodeURI(assetUrl(path))}?v=optimized-1 ${width}w`;
          })
          .join(", ");
      const mobileGifViewport = childWindow.matchMedia("(max-width: 1100px)").matches;
      const coupleGifFilename = "Couple_dancing_in_red_ink_20261024202145_alpha (1)";
      const walkingGifFilename = "Characters_walking_with_dog_20261024202041_alpha";
      const applyWeddingGifs = () => {
        applyResponsiveWeddingPhotos();
        replaceWithGif(
          ".framer-a4ob5c-container",
          `${encodeURI(assetUrl(`/assets/images/${coupleGifFilename}-${mobileGifViewport ? 200 : 560}.gif`))}?v=optimized-1`,
          gifCandidates(coupleGifFilename, [200, 400, 560]),
          "200px",
          true
        );
        replaceWithGif(
          ".framer-11aifpr",
          `${assetUrl(`/assets/images/${walkingGifFilename}-${mobileGifViewport ? 270 : 780}.gif`)}?v=optimized-1`,
          gifCandidates(walkingGifFilename, [270, 387, 540, 780]),
          "(max-width: 1100px) 269px, 387px"
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

      // Esperar el documento del iframe, pero no bloquear la página por el video.
      const markIframeLoaded = () => {
        iframeLoaded = true;
        hideLoaderWhenReady();
      };
      if (childDocument.readyState === "complete") {
        markIframeLoaded();
      } else {
        childDocument.addEventListener("readystatechange", function onReady() {
          if (childDocument.readyState === "complete") {
            childDocument.removeEventListener("readystatechange", onReady);
            markIframeLoaded();
          }
        });
      }

      cleanupFrame = () => {
        removeHeroViewportListener?.();
        if (heroVideoRef.current?.ownerDocument === childDocument) heroVideoRef.current = null;
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
      window.clearTimeout(heroVideoStartTimeout);
      if (hydrationReadyListener && hydrationWaitDocument) {
        hydrationWaitDocument.removeEventListener("framer:hydrated", hydrationReadyListener);
      }
      cleanupFrame?.();
      refreshHeroVideoAfterLoader = undefined;
      document.documentElement.classList.remove("home-scrollbar-hidden");
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
        src={framerHomeUrl(heroDevice)}
        title="Boda de Mari y Simón"
        className="fixed inset-x-0 top-0 z-40 block w-full border-0"
        style={{ height: "100vh" }}
      />
      <button
        type="button"
        className="site-music-button"
        onClick={() => void toggleMusic()}
        aria-label={musicPlaybackError ? "No se pudo activar el audio; volver a intentar" : isMusicPlaying ? "Silenciar audio del video" : "Activar audio sincronizado del video"}
        aria-pressed={isMusicPlaying}
        title={musicPlaybackError ? "No se pudo activar el audio; vuelve a tocar para intentar" : isMusicPlaying ? "Silenciar audio del video" : "Activar audio sincronizado del video"}
      >
        {isMusicPlaying ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      </button>
    </div>
  );
};
