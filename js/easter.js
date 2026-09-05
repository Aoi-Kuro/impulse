/* ═══════════════════════════════════════════════════════════════════
   easter.js  ·  Pi Day & Pi Hour Easter Egg
   ───────────────────────────────────────────────────────────────────
   Triggers:
     • Pi Hour  → clock reads 3:14 AM or 3:14 PM  (any day)
     • Pi Day   → June 20 (TEST MODE — production: March 14)
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Condition check ─────────────────────────────────────────────── */
  function shouldShowEasterEgg () {
    const now    = new Date();
    const month  = now.getMonth() + 1; // 1-based
    const day    = now.getDate();
    const hour   = now.getHours();
    const minute = now.getMinutes();

    const isPiHour = (hour === 3 || hour === 15) && minute === 14;
    // ↓ Change to (month === 3 && day === 14) for production Pi Day
    const isPiDay  = (month === 3 && day === 14); 

    return { trigger: isPiHour || isPiDay, isPiHour, isPiDay };
  }

  /* ── Detect light theme ─────────────────────────────────────────────
     easter.js loads BEFORE quiz-engine.js applies the saved theme to
     document.body. We read localStorage directly to decide light/dark,
     then apply the 'light' class to <body> right now (quiz-engine's
     later init is idempotent) so getComputedStyle already resolves the
     correct theme's CSS variables when we read colors below.          */
  function isLight () {
    let light = false;
    try { light = localStorage.getItem(STORAGE_PREFIX + '-theme') === 'light'; }
    catch (e) { light = false; }
    if (light) document.body.classList.add('light');
    return light;
  }

  /* ── Inject overlay HTML + CSS ───────────────────────────────────── */
  function buildOverlay (isPiHour) {
    const message = isPiHour ? 'Happy π Hour!' : 'Happy π Day!';
    const light   = isLight();

    /* ── Colours read live from CSS variables (theme-agnostic) ── */
    const bgColor      = cssVar('--bg');
    const surfaceColor = cssVar('--surface');
    const borderColor  = cssVar('--accent');
    const textColor    = cssVar('--text');
    const mutedColor   = cssVar('--muted');
    const accentColor  = cssVar('--accent');
    const digitColor   = cssVarRgba('--accent', light ? 0.12 : 0.18);
    const heroGlow1    = cssVarRgba('--accent', light ? 0.35 : 0.6);
    const heroGlow2    = cssVarRgba('--accent', light ? 0.15 : 0.3);
    const bubbleShadow = cssVarRgba('--accent', light ? 0.18 : 0.25);
    const boxShadow2   = cssVarRgba('--shadow', light ? 0.12 : 0.5);

    const style = document.createElement('style');
    style.textContent = `
      /* Import a classic serif for π */
      @import url('https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap');

      #pi-easter-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: ${bgColor};
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        font-family: 'Courier New', monospace;
      }

      /* ── Floating π digits in background ── */
      .pi-digit {
        position: absolute;
        color: ${digitColor};
        font-size: clamp(0.7rem, 2vw, 1.1rem);
        pointer-events: none;
        user-select: none;
        animation: pi-digit-fall linear infinite;
      }
      @keyframes pi-digit-fall {
        0%   { transform: translateY(-60px); opacity: 0; }
        10%  { opacity: 1; }
        90%  { opacity: 1; }
        100% { transform: translateY(110vh);  opacity: 0; }
      }

      /* ── The big π character that flies in ── */
      #pi-hero {
        font-family: 'IM Fell English', 'Georgia', 'Times New Roman', serif;
        font-style: italic;
        font-size: clamp(5rem, 18vw, 11rem);
        font-weight: 400;
        color: ${accentColor};
        text-shadow:
          0 0 40px ${heroGlow1},
          0 0 80px ${heroGlow2};
        line-height: 1;
        pointer-events: none;
        /* Start off-screen left, travel to center, then settle */
        animation: pi-fly 2.4s cubic-bezier(0.22,1,0.36,1) forwards;
        /* Ensure it sits below the bubble with clear separation */
        margin-top: 0.5rem;
      }
      @keyframes pi-fly {
        0%   { transform: translate(-120vw, 0) rotate(-30deg) scale(0.5); opacity: 0; }
        55%  { transform: translate(10px, 0)   rotate(4deg)  scale(1.08); opacity: 1; }
        70%  { transform: translate(-6px, 0)   rotate(-2deg) scale(0.97); opacity: 1; }
        85%  { transform: translate(3px, 0)    rotate(1deg)  scale(1.01); opacity: 1; }
        100% { transform: translate(0, 0)      rotate(0deg)  scale(1);    opacity: 1; }
      }

      /* ── Stage: column layout, bubble on top, π below ── */
      #pi-stage {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
        position: relative;
        z-index: 2;
      }

      /* ── Speech-bubble wrapper ── */
      #pi-bubble-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        opacity: 0;
        transform: translateY(10px) scale(0.9);
        /* Appear after π settles */
        animation: pi-bubble-in 0.5s ease forwards 2.5s;
      }
      @keyframes pi-bubble-in {
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* ── Speech bubble itself ── */
      #pi-bubble {
        background: ${surfaceColor};
        border: 1.5px solid ${borderColor};
        border-radius: 16px;
        padding: 1rem 1.6rem;
        position: relative;
        box-shadow:
          0 0 24px ${bubbleShadow},
          0 8px 32px ${boxShadow2};
        text-align: center;
      }
      /* Bubble tail pointing DOWN toward the π below */
      #pi-bubble::after {
        content: '';
        position: absolute;
        bottom: -13px;
        left: 50%;
        transform: translateX(-50%);
        border-left: 10px solid transparent;
        border-right: 10px solid transparent;
        border-top: 13px solid ${borderColor};
      }
      #pi-bubble::before {
        content: '';
        position: absolute;
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        border-left: 9px solid transparent;
        border-right: 9px solid transparent;
        border-top: 12px solid ${surfaceColor};
        z-index: 1;
      }

      #pi-bubble-text {
        font-size: clamp(1.3rem, 4vw, 2rem);
        font-weight: 700;
        color: ${textColor};
        letter-spacing: 0.03em;
        white-space: nowrap;
      }
      #pi-bubble-sub {
        font-size: clamp(0.65rem, 2vw, 0.8rem);
        color: ${mutedColor};
        margin-top: 0.3rem;
        letter-spacing: 0.08em;
        font-family: 'Courier New', monospace;
      }

      /* ── Fade-out the whole overlay ── */
      #pi-easter-overlay.pi-hide {
        animation: pi-overlay-out 0.6s ease forwards;
      }
      @keyframes pi-overlay-out {
        to { opacity: 0; pointer-events: none; }
      }
    `;
    document.head.appendChild(style);

    /* ── Overlay container ── */
    const overlay = document.createElement('div');
    overlay.id = 'pi-easter-overlay';

    /* ── Falling digit rain ── */
    const digits = '3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067982148086513282306647093844609550582231725359408128481117450284102701938521105559644622948954930381964428810975665933446128475648233786783165271201909145648566923460348610454326648213393607260249141273724587006606315588174881520920962829254091715364367892590360011330530548820466521384146951941511609433057270365759591953092186117381932611793105118548074462379962749567351885752724891227938183011949129833673362440656643086021394946395224737190702179860943702770539217176293176752384674818467669405132000568127145263560827785771342757789609173637178721468440901224953430146549585371050792279689258923542019956112129021960864034418159813629774771309960518707211349999998372978049951059731732816096318595024459455346908302642522308253344685035261931188171010003137838752886587533208381420617177669147303598253490428755468731159562863882353787593751957781857780532171226806613001927876611195909216420198938095257201065485863278865936153381827968230301952035301852968995773622599413891249721775283479131515574857242454150695950829533116861727855889075098381754637464939319255060400927701671139009848824012858361603563707660104710181942955596198946767837449448255379774726847104047534646208046684259069491293313677028989152104752162056966024058038150193511253382430035587640247496473263914199272604269922796782354781636009341721641219924586315030286182974555706749838505494588586926995690927210797509302955321165344987202755960236480665499119881834797753566369807426542527862551818417';
    const cols   = Math.ceil(window.innerWidth / 40) + 2;
    for (let i = 0; i < cols * 2; i++) {
      const d = document.createElement('span');
      d.className = 'pi-digit';
      d.textContent = digits[Math.floor(Math.random() * digits.length)];
      const left     = Math.random() * 100;
      const duration = 4 + Math.random() * 8;
      const delay    = -Math.random() * 10;
      d.style.cssText = `
        left: ${left}%;
        animation-duration: ${duration}s;
        animation-delay: ${delay}s;
        font-size: ${0.6 + Math.random() * 0.9}rem;
      `;
      overlay.appendChild(d);
    }

    /* ── Centre stage: bubble on top, π hero below ── */
    const stage = document.createElement('div');
    stage.id = 'pi-stage';

    /* Bubble sits ABOVE the π */
    const bubbleWrap = document.createElement('div');
    bubbleWrap.id = 'pi-bubble-wrap';

    const bubble = document.createElement('div');
    bubble.id = 'pi-bubble';

    const bubbleText = document.createElement('div');
    bubbleText.id    = 'pi-bubble-text';
    bubbleText.textContent = message;

    const bubbleSub = document.createElement('div');
    bubbleSub.id    = 'pi-bubble-sub';
    bubbleSub.textContent = isPiHour
      ? 'π ≈ 3.14159…  ·  it\'s 3:14!'
      : 'π ≈ 3.14159…  ·  March 14';

    bubble.appendChild(bubbleText);
    bubble.appendChild(bubbleSub);
    bubbleWrap.appendChild(bubble);

    /* The big π — below the bubble */
    const hero = document.createElement('div');
    hero.id          = 'pi-hero';
    hero.textContent = 'π';

    stage.appendChild(bubbleWrap);
    stage.appendChild(hero);
    overlay.appendChild(stage);
    return overlay;
  }

  /* ── Dismiss / remove overlay ────────────────────────────────────── */
  function dismissOverlay () {
    const overlay = document.getElementById('pi-easter-overlay');
    if (!overlay) return;
    overlay.classList.add('pi-hide');
    setTimeout(() => overlay.remove(), 650);
  }

  /* ── Auto-dismiss after ~6.5 s total (bubble appears at 2.5 s) ──── */
  function scheduleAutoDismiss () {
    setTimeout(dismissOverlay, 6500);
  }

  /* ── Main entry point ────────────────────────────────────────────── */
  function init () {
    const { trigger, isPiHour } = shouldShowEasterEgg();
    if (!trigger) return;

    const overlay = buildOverlay(isPiHour);
    document.body.appendChild(overlay);
    scheduleAutoDismiss();
  }

  /* Run as early as possible — before DOMContentLoaded if body exists,
     otherwise wait for it.                                              */
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
