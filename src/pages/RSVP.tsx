import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Key,
  Users,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  ShieldCheck,
  Calendar,
  Utensils,
  Heart,
  Lock,
  Bus,
  FileText,
  Sparkles,
  RotateCcw,
  Clock,
  MapPin,
  Download,
  MessageCircle
} from "lucide-react";
import { Invitation, Guest } from "../types";
import { BrandLogo } from "../components/Brand/BrandLogo";
import { apiUrl, apiUrlPair, fetchJsonWithFallback } from "../lib/base";

interface RsvpProps {
  initialCode?: string;
  onAdminClick?: () => void;
}

export const RSVP: React.FC<RsvpProps> = ({ initialCode, onAdminClick }) => {
  // Navigation steps: 'auth' | 'form' | 'success'
  const [step, setStep] = useState<'auth' | 'form' | 'success'>('auth');
  const [codeInput, setCodeInput] = useState(initialCode || "");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  
  // UI States
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notificationWarning, setNotificationWarning] = useState<string | null>(null);

  // Form states (managed locally once invitation is loaded)
  const [guestsState, setGuestsState] = useState<Guest[]>([]);
  const [generalStatus, setGeneralStatus] = useState<'pending' | 'confirmed' | 'declined'>('pending');
  const [youtubeEmail, setYoutubeEmail] = useState("");

  // Auto-validate if initialCode was passed
  useEffect(() => {
    if (initialCode && initialCode.trim()) {
      executeValidateCode(initialCode.trim().toUpperCase());
    }
  }, [initialCode]);

  const executeValidateCode = async (codeToValidate: string) => {
    if (loading) return;
    if (!codeToValidate) {
      setErrorMessage("Por favor, ingresá un código.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

    try {
      const pair = apiUrlPair(`rsvp/${encodeURIComponent(codeToValidate)}`);
      const data = await fetchJsonWithFallback<any>(pair.primary, pair.fallback);

      if (data.success) {
        setInvitation(data.invitation);
        setGuestsState((data.invitation.guests || []).map((guest: Guest) => ({
          ...guest,
          isAttending: data.invitation.status === 'pending'
            ? null
            : data.invitation.status === 'declined'
            ? false
            : guest.isAttending ?? null
        })));
        setGeneralStatus(data.invitation.status);
        setYoutubeEmail(data.invitation.youtubeEmail || "");
        setStep('form');
      } else {
        setErrorMessage(data.error || "Código inválido. Por favor verificá que esté bien escrito e intentalo de nuevo.");
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Ocurrió un error al conectar con el servidor. Intentalo de nuevo en unos momentos.");
    } finally {
      setLoading(false);
    }
  };

  const handleValidateCode = (e: React.FormEvent) => {
    e.preventDefault();
    executeValidateCode(codeInput.trim().toUpperCase());
  };

  const handleGuestFieldChange = (index: number, field: keyof Guest, value: any) => {
    setGuestsState(currentGuests => currentGuests.map((guest, guestIndex) =>
      guestIndex === index ? { ...guest, [field]: value } : guest
    ));
  };

  const handleSubmitRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    if (generalStatus === 'pending') {
      setErrorMessage("Seleccioná si asistirán o no antes de continuar.");
      return;
    }
    if (generalStatus === 'confirmed' && guestsState.some(guest => guest.isAttending === null)) {
      setErrorMessage("Seleccioná Sí o No para cada invitado antes de enviar la confirmación.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setNotificationWarning(null);

    // If generalStatus is declined, set all guests to isAttending: false
    const finalGuests = guestsState.map(({ transportLocation: _transportLocation, ...guest }) => ({
      ...guest,
      isAttending: generalStatus === 'declined' ? false : guest.isAttending
    }));

    try {
      const response = await fetch(apiUrl(`rsvp/${encodeURIComponent(invitation.code)}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          guests: finalGuests,
          status: generalStatus,
          youtubeEmail: youtubeEmail.trim()
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setInvitation(data.invitation);
        if (data.notification && data.notification.sent === false) {
          setNotificationWarning(
            data.notification.reason === "not_configured"
              ? "Tu respuesta quedó guardada, pero todavía falta configurar el aviso por email a los organizadores."
              : "Tu respuesta quedó guardada, pero no pudimos enviar el aviso por email a los organizadores. No hace falta que vuelvas a enviarla."
          );
        }
        setStep('success');
      } else {
        setErrorMessage(data.error || "Ocurrió un error al guardar tu confirmación.");
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Error de conexión al servidor.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadIcs = () => {
    // 03rd Apr 2027 15:30 ART (UTC-3) -> 18:30 UTC
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Mari y Simon//Boda RSVP//ES",
      "BEGIN:VEVENT",
      "UID:boda-mari-simon-2027-04-03",
      "DTSTAMP:20261018T120000Z",
      "DTSTART:20270403T183000Z",
      "DTEND:20270404T080000Z",
      "SUMMARY:Boda de Mari & Simón 💍",
      "DESCRIPTION:¡Gran día! Boda de Mariángel & Simón. Celebración en Potrerillos, Mendoza, Argentina.",
      "LOCATION:Potrerillos, Mendoza, Argentina",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "Boda_Mari_y_Simon_2027.ics");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const demoCode = "INVITADO6";
  const transportReservationCount = guestsState.filter(guest => guest.isAttending && guest.needsTransport).length;

  return (
    <div
      className="rsvp-page py-5 sm:py-12 md:py-20 px-2 sm:px-4 relative flex items-center justify-center overflow-hidden"
      aria-busy={loading}
    >
      <AnimatePresence mode="wait">
        
        {/* STEP 1: AUTHENTICATION VIA CODE (HOME / MAIN ACCESS) */}
        {step === 'auth' && (
          <motion.div
            key="auth-view"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35 }}
            className="rsvp-auth-card w-full max-w-lg bg-white/95 backdrop-blur-xs p-4 sm:p-8 md:p-12 rounded-3xl border border-[#363B1F]/15 shadow-[0_12px_45px_rgba(54,59,31,0.06)] text-center space-y-6 sm:space-y-8 relative z-10"
          >
            {/* Header info */}
            <div className="space-y-4">
              <div className="flex justify-center">
                <BrandLogo fontSize="text-4xl" />
              </div>

              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#363B1F]/5 border border-[#363B1F]/10 text-[#363B1F] text-[11px] font-mono uppercase tracking-widest font-semibold">
                <Calendar className="w-3.5 h-3.5 text-[#6E0D23]" />
                03 de Abril de 2027 • Mendoza
              </div>
              
              <h1 className="font-serif text-3xl md:text-4xl font-bold text-[#363B1F] tracking-tight">
                Confirmar Asistencia
              </h1>
              
              <p className="rsvp-intro text-xs sm:text-sm text-[#626262] leading-relaxed font-manrope max-w-sm mx-auto text-center">
                Ingresá el código de invitación que recibiste en tu tarjeta para ver tus pases reservados y personalizar los detalles de tu asistencia.
              </p>
            </div>

            {/* Input Form */}
            <form onSubmit={handleValidateCode} className="space-y-5 text-left">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="rsvp-code" className="text-xs font-mono uppercase tracking-wider text-[#363B1F] font-bold flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-[#6E0D23]" /> Código de Invitación
                  </label>
                  <span className="text-[10px] text-[#626262] font-mono">Personal & Intransferible</span>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    id="rsvp-code"
                    placeholder="Ej: MARISIMON"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    disabled={loading}
                    className="w-full px-5 py-4 bg-[#FAF6F2] border border-[#363B1F]/20 rounded-2xl font-mono text-center text-xl uppercase tracking-[0.25em] font-bold text-[#363B1F] focus:outline-none focus:border-[#363B1F] focus:ring-2 focus:ring-[#363B1F]/20 transition-all placeholder:text-[#626262]/40"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>

              {/* Error block */}
              {errorMessage && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-rose-700 text-xs font-manrope animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                id="btn-validate-code"
                disabled={loading}
                className="w-full py-4 bg-[#363B1F] hover:bg-[#272B15] text-[#FAF6F2] rounded-2xl font-manrope font-bold text-sm tracking-wider uppercase shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75 active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Consultando invitación...
                  </>
                ) : (
                  <>
                    Ver mi Invitación <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Quick demo codes pills */}
            <div className="pt-2 border-t border-[#363B1F]/10 space-y-3">
              <span className="text-[10px] font-mono text-[#626262] uppercase tracking-wider block">
                ¿Querés probar con un código de demostración?
              </span>
              <button
                type="button"
                onClick={() => {
                  setCodeInput(demoCode);
                  executeValidateCode(demoCode);
                }}
                className="px-4 py-2 rounded-full bg-[#FAF6F2] hover:bg-[#F1EBE3] border border-[#363B1F]/15 text-[#363B1F] text-xs font-mono tracking-wider transition-colors cursor-pointer"
              >
                Invitado de prueba
              </button>
            </div>

            {/* WhatsApp button for guests */}
            <div className="pt-2 text-center">
              <a
                href={`https://wa.me/5491176387793?text=${encodeURIComponent("¡Hola Mari y Simón! No recuerdo mi código de invitación para la boda, ¿me lo podrían recordar?")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-[#FAF6F2] hover:bg-[#F1EBE3] border border-[#363B1F]/15 text-[#363B1F] text-xs font-manrope font-semibold transition-all duration-200 cursor-pointer shadow-xs hover:border-[#363B1F]/30 active:scale-95"
              >
                <MessageCircle className="w-4 h-4 text-emerald-600" />
                <span>¿No recuerdas tu código? Escríbenos al WhatsApp</span>
              </a>
            </div>
          </motion.div>
        )}

        {/* STEP 2: DYNAMIC RSVP FORM */}
        {step === 'form' && invitation && (
          <motion.div
            key="form-view"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35 }}
            className="rsvp-form-card w-full max-w-2xl bg-white/95 backdrop-blur-xs p-6 md:p-10 rounded-3xl border border-[#363B1F]/15 shadow-[0_12px_45px_rgba(54,59,31,0.06)] relative z-10"
          >
            {/* Header info */}
            <div className="border-b border-[#363B1F]/10 pb-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[#6E0D23] font-bold bg-[#F0D9DF]/60 px-2.5 py-0.5 rounded-full">
                    Código: {invitation.code}
                  </span>
                  <span className="text-[10px] font-mono text-[#626262]">
                    {invitation.status === 'confirmed' ? '✓ Asistencia confirmada previamente' : 'Pendiente de confirmación'}
                  </span>
                </div>
                
                <h2 className="font-serif text-2xl md:text-3xl font-bold text-[#363B1F]">
                  ¡Hola {invitation.names}!
                </h2>
                <p className="text-xs sm:text-sm text-[#626262] font-manrope">
                  Tenés <strong className="text-[#363B1F] font-bold">{invitation.passes} {invitation.passes === 1 ? 'pase' : 'pases'}</strong> reservados para acompañarnos.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('auth');
                    setCodeInput("");
                  }}
                  className="px-4 py-2 border border-[#363B1F]/20 text-xs font-mono text-[#363B1F] rounded-full hover:bg-[#FAF6F2] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Cambiar Código
                </button>
              </div>
            </div>

            {/* General Confirmation Toggle */}
            <form onSubmit={handleSubmitRsvp} className="space-y-8 text-left">
              
              <div className="bg-[#FAF6F2] p-5 md:p-6 rounded-2xl border border-[#363B1F]/10 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono uppercase tracking-widest text-[#363B1F] font-bold flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#6E0D23]" /> ¿Nos vas a acompañar el 03 de Abril de 2027?
                  </h4>
                </div>
                
                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <legend className="sr-only">Seleccioná si asistirán a la boda</legend>
                  <label className={`py-3.5 px-4 rounded-xl font-manrope font-semibold text-xs sm:text-sm border transition-all cursor-pointer flex items-center gap-3 ${
                    generalStatus === 'confirmed'
                      ? 'bg-emerald-50 border-emerald-700 text-emerald-900 shadow-sm ring-2 ring-emerald-700/20'
                      : 'bg-white border-[#363B1F]/15 text-[#363B1F] hover:bg-white/80'
                  }`}>
                    <input
                      type="radio"
                      name="general-attendance"
                      value="confirmed"
                      checked={generalStatus === 'confirmed'}
                      onChange={() => setGeneralStatus('confirmed')}
                      className="w-5 h-5 shrink-0 accent-emerald-700"
                    />
                    <span><strong>Sí, asistiré</strong><span className="block text-[11px] font-normal opacity-80">Confirmar asistencia</span></span>
                  </label>
                  <label className={`py-3.5 px-4 rounded-xl font-manrope font-semibold text-xs sm:text-sm border transition-all cursor-pointer flex items-center gap-3 ${
                    generalStatus === 'declined'
                      ? 'bg-rose-50 border-rose-700 text-rose-900 shadow-sm ring-2 ring-rose-700/20'
                      : 'bg-white border-[#363B1F]/15 text-[#363B1F] hover:bg-white/80'
                  }`}>
                    <input
                      type="radio"
                      name="general-attendance"
                      value="declined"
                      checked={generalStatus === 'declined'}
                      onChange={() => setGeneralStatus('declined')}
                      className="w-5 h-5 shrink-0 accent-rose-700"
                    />
                    <span><strong>No, no asistiré</strong><span className="block text-[11px] font-normal opacity-80">Rechazar invitación</span></span>
                  </label>
                  {generalStatus === 'pending' && (
                    <p className="sm:col-span-2 text-xs text-amber-800" role="status">
                      Elegí una opción para continuar. Tu respuesta todavía está pendiente.
                    </p>
                  )}
                </fieldset>
              </div>

              {/* Dynamic Individual Guests Form */}
              {generalStatus === 'confirmed' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-[#363B1F]/10 pb-2">
                    <h3 className="font-serif font-bold text-lg text-[#363B1F] flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#6E0D23]" /> Detalle de Cada Asistente ({guestsState.length})
                    </h3>
                    <span className="text-[11px] font-mono text-[#626262]">Revisá asistencia y preferencias</span>
                  </div>

                  {guestsState.map((guest, idx) => (
                    <div
                      key={idx}
                      className="p-5 border border-[#363B1F]/15 rounded-2xl bg-[#FAF6F2]/60 space-y-4 relative"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#363B1F]/10 pb-3">
                        {/* Guest name input */}
                        <div className="w-full sm:max-w-xs space-y-1">
                          <label className="text-[10px] font-mono text-[#626262] uppercase font-bold flex items-center gap-1">
                            Pase {idx + 1} de {invitation.passes} · Nombre asignado
                          </label>
                          <input
                            type="text"
                            required={guest.isAttending === true}
                            value={guest.name}
                            readOnly
                            aria-readonly="true"
                            className="w-full px-3.5 py-2.5 bg-[#FAF6F2] border border-[#363B1F]/20 rounded-xl text-sm font-manrope text-[#626262] cursor-default"
                            placeholder="Nombre y Apellido completo"
                          />
                        </div>

                        <fieldset className="flex flex-col gap-2 pt-2 sm:pt-0">
                          <legend className="text-[10px] font-mono uppercase tracking-wider text-[#626262] font-bold">
                            ¿Asiste esta persona?
                          </legend>
                          <div className="flex flex-wrap gap-2">
                            <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                              guest.isAttending === true
                                ? 'bg-emerald-50 text-emerald-900 border-emerald-700 ring-1 ring-emerald-700/20'
                                : 'bg-white text-[#363B1F] border-[#363B1F]/20 hover:bg-emerald-50/50'
                            }`}>
                              <input
                                type="radio"
                                name={`guest-attendance-${idx}`}
                                value="yes"
                                checked={guest.isAttending === true}
                                required
                                onChange={() => handleGuestFieldChange(idx, "isAttending", true)}
                                className="w-4 h-4 accent-emerald-700"
                              />
                              Sí, asiste
                            </label>
                            <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                              guest.isAttending === false
                                ? 'bg-rose-50 text-rose-900 border-rose-700 ring-1 ring-rose-700/20'
                                : 'bg-white text-[#363B1F] border-[#363B1F]/20 hover:bg-rose-50/50'
                            }`}>
                              <input
                                type="radio"
                                name={`guest-attendance-${idx}`}
                                value="no"
                                checked={guest.isAttending === false}
                                required
                                onChange={() => handleGuestFieldChange(idx, "isAttending", false)}
                                className="w-4 h-4 accent-rose-700"
                              />
                              No asiste
                            </label>
                          </div>
                        </fieldset>
                      </div>

                      {/* Guest preferences (only visible if guest is attending) */}
                      {guest.isAttending && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                          {/* Dietary dropdown */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-mono text-[#626262] uppercase font-bold flex items-center gap-1">
                              <Utensils className="w-3.5 h-3.5 text-[#6E0D23]" /> Menú Especial / Dietas
                            </label>
                            <select
                              value={guest.dietaryRestrictions}
                              onChange={(e) => handleGuestFieldChange(idx, "dietaryRestrictions", e.target.value)}
                              className="w-full px-3 py-2.5 bg-white border border-[#363B1F]/20 rounded-xl text-xs font-manrope focus:outline-none focus:border-[#363B1F] cursor-pointer"
                            >
                              <option value="none">Menú Estándar (Tradicional)</option>
                              <option value="celiac">Menú Sin TACC (Celíaco)</option>
                              <option value="vegetarian">Menú Vegetariano</option>
                              <option value="vegan">Menú Vegano</option>
                              <option value="child">Menú Infantil</option>
                              <option value="allergy">Alérgico (especificar en notas)</option>
                            </select>
                          </div>

                          {/* Notes */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-mono text-[#626262] uppercase font-bold flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5 text-[#6E0D23]" /> Notas o Alergias específicas
                            </label>
                            <input
                              type="text"
                              value={guest.notes || ""}
                              onChange={(e) => handleGuestFieldChange(idx, "notes", e.target.value)}
                              placeholder="Ej: Alergia a nueces / Mensaje para novios"
                              className="w-full px-3 py-2.5 bg-white border border-[#363B1F]/20 rounded-xl text-xs font-manrope focus:outline-none focus:border-[#363B1F]"
                            />
                          </div>

                          {/* Transport / Shuttle */}
                          <div className="sm:col-span-2 space-y-3 pt-3 border-t border-[#363B1F]/10">
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={!!guest.needsTransport}
                                onChange={(e) => {
                                  handleGuestFieldChange(idx, "needsTransport", e.target.checked);
                                  handleGuestFieldChange(idx, "transportLocation", "");
                                }}
                                className="w-4 h-4 rounded text-[#6E0D23] focus:ring-[#6E0D23] border-[#363B1F]/30 accent-[#6E0D23] cursor-pointer"
                              />
                              <span className="text-xs font-manrope font-bold text-[#363B1F] flex items-center gap-1.5">
                                <Bus className="w-3.5 h-3.5 text-[#6E0D23]" /> ¿Necesitás transporte desde la boda en Potrerillos hasta Mendoza Capital?
                              </span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Decline state summary */}
              {generalStatus === 'declined' && (
                <div className="p-6 border border-[#6E0D23]/20 bg-rose-50/50 rounded-2xl text-center space-y-2">
                  <p className="font-serif italic text-[#363B1F] text-base">
                    Lamentamos mucho que no nos puedan acompañar en Mendoza en esta ocasión.
                  </p>
                  <p className="text-xs text-[#626262] font-manrope">
                    Tus pases quedarán liberados para otras personas. De todas formas, nos encantará que nos acompañes online; dejanos el correo asociado a tu cuenta de YouTube y te enviaremos el enlace al live cuando esté disponible.
                  </p>
                  <div className="pt-3 text-left space-y-1.5">
                    <label htmlFor="youtube-live-email" className="text-[10px] font-mono text-[#626262] uppercase font-bold">
                      Correo de tu cuenta de YouTube
                    </label>
                    <input
                      id="youtube-live-email"
                      type="email"
                      required={generalStatus === 'declined'}
                      autoComplete="email"
                      value={youtubeEmail}
                      onChange={(event) => setYoutubeEmail(event.target.value)}
                      placeholder="nombre@ejemplo.com"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#363B1F]/20 rounded-xl text-sm font-manrope focus:outline-none focus:border-[#363B1F] focus:ring-1 focus:ring-[#363B1F]"
                    />
                  </div>
                </div>
              )}

              {/* Server errors */}
              {errorMessage && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit panel */}
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#363B1F]/10">
                <button
                  type="button"
                  onClick={() => setStep('auth')}
                  className="text-xs font-mono uppercase tracking-wider text-[#626262] hover:text-[#363B1F] flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Cancelar
                </button>

                <button
                  type="submit"
                  id="btn-submit-rsvp"
                  disabled={isSubmitting || generalStatus === 'pending'}
                  className="w-full sm:w-auto px-8 py-3.5 bg-[#363B1F] hover:bg-[#272B15] text-[#FAF6F2] font-manrope font-bold text-xs sm:text-sm tracking-wider uppercase rounded-full shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Guardando confirmación...
                    </>
                  ) : (
                    <>
                      Enviar Confirmación <ShieldCheck className="w-4 h-4 text-emerald-300" />
                    </>
                  )}
                </button>
              </div>

            </form>
          </motion.div>
        )}

        {/* STEP 3: SUCCESS / THANK YOU VIEW */}
        {step === 'success' && invitation && (
          <motion.div
            key="success-view"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="rsvp-success-card w-full max-w-lg bg-white/95 backdrop-blur-xs p-8 md:p-12 rounded-3xl border border-[#363B1F]/15 shadow-[0_12px_45px_rgba(54,59,31,0.06)] text-center space-y-6 relative z-10"
          >
            <div className="w-16 h-16 bg-emerald-50 text-emerald-700 rounded-full flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#6E0D23] font-bold">
                Respuesta Registrada
              </span>
              <h2 className="font-serif text-3xl font-bold text-[#363B1F] tracking-tight">
                {generalStatus === 'confirmed' ? "¡Los esperamos en Mendoza! 🎉" : "¡Muchas Gracias! ❤️"}
              </h2>
              <p className="text-xs sm:text-sm text-[#626262] font-manrope max-w-sm mx-auto leading-relaxed">
                {generalStatus === 'confirmed'
                  ? "Tu confirmación ha sido guardada en nuestra base de datos oficial. Nos alegra inmensamente que nos acompañes en este día tan especial."
                  : "Tus pases quedaron liberados y guardamos tu respuesta. ¡Nos encantará que nos acompañes online! Te enviaremos el enlace del live al correo de YouTube indicado."}
              </p>
              {notificationWarning && (
                <p role="status" className="mx-auto max-w-sm rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-xs text-amber-900">
                  {notificationWarning}
                </p>
              )}
            </div>

            {/* Quick summary card */}
            <div className="p-5 bg-[#FAF6F2] border border-[#363B1F]/10 rounded-2xl text-left text-xs text-[#363B1F] space-y-2">
              <div className="flex justify-between items-center border-b border-[#363B1F]/10 pb-2">
                <span className="font-mono text-[10px] uppercase text-[#626262]">Invitación</span>
                <span className="font-mono font-bold text-[#6E0D23]">{invitation.code}</span>
              </div>
              <p><strong>Titular(es):</strong> {invitation.names}</p>
              <p><strong>Pases totales:</strong> {invitation.passes}</p>
              <p>
                <strong>Asistentes:</strong>{" "}
                {generalStatus === 'confirmed'
                  ? guestsState.filter(g => g.isAttending).map(g => g.name).join(", ") || "Ninguno"
                  : "Declinado"}
              </p>
              {generalStatus === 'declined' && invitation.youtubeEmail && (
                <p><strong>Email para el live:</strong> {invitation.youtubeEmail}</p>
              )}
              {generalStatus === 'confirmed' && (
                <p className="text-emerald-700 font-semibold flex items-center gap-1">
                  <Bus className="w-3.5 h-3.5" />
                  {transportReservationCount > 0
                    ? `Transporte: ${transportReservationCount} asiento${transportReservationCount === 1 ? "" : "s"} reservado${transportReservationCount === 1 ? "" : "s"} · X$ por persona.`
                    : "Transporte: sin asientos reservados."}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="pt-2 flex flex-col gap-3">
              {generalStatus === 'confirmed' && (
                <button
                  type="button"
                  onClick={downloadIcs}
                  className="w-full py-3.5 bg-[#FAF6F2] hover:bg-[#F1EBE3] text-[#363B1F] border border-[#363B1F]/20 rounded-full font-manrope font-semibold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Calendar className="w-4 h-4 text-[#6E0D23]" /> Agendar Boda en mi Calendario (.ics)
                </button>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="flex-1 py-3 border border-[#363B1F]/20 text-[#363B1F] hover:bg-[#FAF6F2] rounded-full font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Modificar datos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('auth');
                    setCodeInput("");
                  }}
                  className="flex-1 py-3 bg-[#363B1F] hover:bg-[#272B15] text-[#FAF6F2] rounded-full font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Consultar otro código
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {loading && createPortal(
        <AnimatePresence>
          <motion.div
            role="status"
            aria-live="polite"
            aria-label="Cargando invitación"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#FAF6F2]/75 px-4 backdrop-blur-sm"
          >
            <div className="w-full max-w-sm rounded-3xl border border-[#363B1F]/15 bg-white p-8 text-center shadow-2xl">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#363B1F]/10 border-t-[#6E0D23] animate-spin" />
              <h2 className="font-serif text-xl font-bold text-[#363B1F]">Buscando tu invitación</h2>
              <p className="mt-2 text-sm text-[#626262]">
                Estamos cargando los datos. Puede tardar unos segundos; por favor, no cierres esta página.
              </p>
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};
