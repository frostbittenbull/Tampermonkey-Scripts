// ==UserScript==
// @name         Universal Video Resizer & Mover & Rotation (Video-Only)
// @namespace    http://tampermonkey.net/
// @version      19.4
// @description  Zero Auto-Resize, Render Bug Fix, Persistent Handles + Rotate Video Picture Only. Pure Hover Logic. Corner Resize. Zero-lag overlay. True Video Bounds (No Stretch/Distortion). Prev/Next buttons.
// @author       frostbittenbull
// @updateURL    https://raw.githubusercontent.com/frostbittenbull/TamperMonkey-Scripts/main/Video-Tools/Universal-Video-Resizer-Mover-Rotation.user.js
// @downloadURL  https://raw.githubusercontent.com/frostbittenbull/TamperMonkey-Scripts/main/Video-Tools/Universal-Video-Resizer-Mover-Rotation.user.js
// @match        *://*/*
// @allFrames    true
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const Z_HANDLES = '2147483647';
    const Z_OVERLAY = '2147483646';
    const Z_PLAYER  = '2147483645';
    const Z_PARENTS = '2147483644';

    const inIframe = window.self !== window.top;
    const TEXT_DRAG = inIframe ? "DRAG [F]" : "DRAG";
    const TEXT_LOCKED = inIframe ? "LOCKED [F]" : "LOCKED";

    const moveHandle = document.createElement('div');
    moveHandle.style.cssText = `
        position: fixed; width: 85px; height: 25px;
        cursor: pointer; z-index: ${Z_HANDLES};
        background: rgba(226, 43, 43, 0.9);
        pointer-events: auto; display: none; transition: opacity 0.3s, background 0.3s;
        opacity: 0.4; border-radius: 0 0 10px 10px; text-align: center;
        color: white; font-family: sans-serif; font-weight: bold; font-size: 11px;
        line-height: 25px; user-select: none; box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        ${inIframe ? 'border: 2px dashed #ffeb3b; border-top: none;' : ''}
    `;
    moveHandle.innerText = TEXT_DRAG;
    moveHandle.title = "Click (Ctrl+Space): Lock\nScroll (Ctrl+Up/Down): Opacity\nCtrl+Left/Right: Rotate Picture\nDouble click (Ctrl+R): Reset\nCtrl+H: Hide UI";

    document.body.appendChild(moveHandle);

    const cornerHandles = {};
    const cursors = { TL: 'nwse-resize', TR: 'nesw-resize', BL: 'nesw-resize', BR: 'nwse-resize' };
    ['TL', 'TR', 'BL', 'BR'].forEach(corner => {
        const handle = document.createElement('div');
        handle.style.cssText = `
            position: fixed; width: 30px; height: 30px;
            cursor: ${cursors[corner]}; z-index: ${Z_HANDLES};
            pointer-events: auto; display: none; background: transparent;
        `;
        document.body.appendChild(handle);
        cornerHandles[corner] = handle;

        handle.addEventListener('mousedown', (e) => {
            if (!activeVideo) return;
            if (!isLocked) lockPlayer();

            isResizing = true;
            activeCorner = corner;

            startX = e.clientX; startY = e.clientY;
            startWidth = activeVideo.offsetWidth;
            startHeight = activeVideo.offsetHeight;
            originalVideoRect = {width: startWidth, height: startHeight, aspectRatio: startWidth / startHeight};
            
            startLeft = parseFloat(activeVideo.style.left) || getVideoBounds(activeVideo).left;
            startTop = parseFloat(activeVideo.style.top) || getVideoBounds(activeVideo).top;
            
            e.preventDefault();
        });
    });

    let videos = [];
    let activeVideo = null;
    let originalVideoRect = null;
    let isResizing = false;
    let isMoving = false;
    let isLocked = false;
    let activeCorner = null;

    let isUiGloballyHidden = false;
    let isUiVisible = false;
    let tempMsgTimeout = null;

    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let currentOpacityInt = 100;
    let currentRotationInt = 0;
    let moveOffsetX, moveOffsetY;

    let ticking = false;
    let latestMouseEvent = null;
    let syncOverlayPosition = null;

    let savedInlineStyles = {};
    let boostedParents = [];
    const propsToHijack = ['position', 'z-index', 'left', 'top', 'margin', 'width', 'height', 'max-width', 'max-height', 'transition', 'opacity', 'transform', 'box-sizing', 'object-fit'];

    function setStyles(el, styles) {
        if (!el) return;
        for (const [prop, val] of Object.entries(styles)) {
            el.style.setProperty(prop, val, 'important');
        }
    }

    // Высчитываем реальные границы изображения без чёрных полос (letterboxing/pillarboxing)
    function getVideoBounds(video) {
        const rect = video.getBoundingClientRect();
        let trueWidth = rect.width;
        let trueHeight = rect.height;
        let leftOffset = rect.left;
        let topOffset = rect.top;

        if (video.videoWidth && video.videoHeight) {
            const videoRatio = video.videoWidth / video.videoHeight;
            const boxRatio = rect.width / rect.height;

            if (videoRatio > boxRatio + 0.01) {
                trueHeight = rect.width / videoRatio;
                topOffset = rect.top + (rect.height - trueHeight) / 2;
            } else if (videoRatio < boxRatio - 0.01) {
                trueWidth = rect.height * videoRatio;
                leftOffset = rect.left + (rect.width - trueWidth) / 2;
            }
        }
        return {
            left: leftOffset,
            top: topOffset,
            width: trueWidth,
            height: trueHeight,
            right: leftOffset + trueWidth,
            bottom: topOffset + trueHeight
        };
    }

    moveHandle.addEventListener('mouseenter', () => { if (!isUiGloballyHidden) setStyles(moveHandle, { opacity: '1' }); });
    moveHandle.addEventListener('mouseleave', () => { if (!isMoving && !isUiGloballyHidden) setStyles(moveHandle, { opacity: '0.4' }); });

    function showTemporaryMessage(msg, duration = 1000) {
        moveHandle.innerText = msg;
        clearTimeout(tempMsgTimeout);
        tempMsgTimeout = setTimeout(() => {
            moveHandle.innerText = isLocked ? TEXT_LOCKED : TEXT_DRAG;
        }, duration);
    }

    function applyUiVisibility(show) {
        if (isUiGloballyHidden) {
            Object.values(cornerHandles).forEach(h => setStyles(h, { display: 'none' }));
            setStyles(moveHandle, { display: 'none' });
            isUiVisible = false;
            return;
        }

        if (show) {
            if (!isUiVisible) {
                Object.values(cornerHandles).forEach(h => setStyles(h, { display: 'block' }));
                setStyles(moveHandle, { display: 'block', opacity: isMoving ? '1' : '0.4' });
                isUiVisible = true;
            }
        } else {
            if (isUiVisible) {
                Object.values(cornerHandles).forEach(h => setStyles(h, { display: 'none' }));
                setStyles(moveHandle, { display: 'none' });
                isUiVisible = false;
            }
        }
    }

    function updateVideosList() {
        videos = Array.from(document.querySelectorAll('video'));
    }

    const observer = new MutationObserver((mutations) => {
        if (isLocked) return;
        let needsUpdate = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1 && (node.tagName === 'VIDEO' || node.querySelector('video'))) {
                    needsUpdate = true; break;
                }
            }
        }
        if (needsUpdate) updateVideosList();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    updateVideosList();

    function updateHandlesPosition() {
        if (!activeVideo || !document.body.contains(activeVideo)) return;
        const bounds = getVideoBounds(activeVideo);
        const size = 30;

        setStyles(cornerHandles.TL, { left: `${bounds.left}px`, top: `${bounds.top}px` });
        setStyles(cornerHandles.TR, { left: `${bounds.right - size}px`, top: `${bounds.top}px` });
        setStyles(cornerHandles.BL, { left: `${bounds.left}px`, top: `${bounds.bottom - size}px` });
        setStyles(cornerHandles.BR, { left: `${bounds.right - size}px`, top: `${bounds.bottom - size}px` });

        setStyles(moveHandle, { left: `${Math.round(bounds.left + (bounds.width / 2) - 42)}px`, top: `${Math.round(bounds.top)}px` });
    }

    function hijackVideo() {
        if (activeVideo.dataset.hijacked === "true") return;

        savedInlineStyles = {};
        propsToHijack.forEach(prop => {
            savedInlineStyles[prop] = activeVideo.style.getPropertyValue(prop);
            savedInlineStyles[prop + '_priority'] = activeVideo.style.getPropertyPriority(prop);
        });

        const bounds = getVideoBounds(activeVideo);
        originalVideoRect = {width: bounds.width, height: bounds.height, aspectRatio: bounds.width / bounds.height};

        setStyles(activeVideo, {
            'transition': 'none', 'position': 'fixed', 'z-index': Z_PLAYER,
            'left': `${Math.round(bounds.left)}px`, 'top': `${Math.round(bounds.top)}px`,
            'width': `${Math.round(bounds.width)}px`, 'height': `${Math.round(bounds.height)}px`,
            'margin': '0', 'max-width': 'none', 'max-height': 'none',
            'box-sizing': 'border-box',
            'object-fit': 'contain', // Защита от искажения пропорций
        });

        let p = activeVideo.parentElement;
        while(p && p !== document.body && p !== document.documentElement) {
            if (!boostedParents.some(item => item.element === p)) {
                boostedParents.push({ element: p, originalZ: p.style.zIndex });
                p.style.setProperty('z-index', Z_PARENTS, 'important');
            }
            p = p.parentElement;
        }

        activeVideo.dataset.hijacked = "true";
        void activeVideo.offsetHeight;
    }

    function applyVideoTransform() {
        if (!activeVideo) return;
        let scale = 1;
        if (currentRotationInt % 180 !== 0) {
            const w = activeVideo.offsetWidth;
            const h = activeVideo.offsetHeight;
            if (h > 0 && w > 0) scale = Math.min(w / h, h / w);
        }
        setStyles(activeVideo, { 'transform': `rotate(${currentRotationInt}deg) scale(${scale})`, 'transform-origin': 'center center' });
    }

    function lockPlayer() {
        if (isLocked || !activeVideo) return;

        currentRotationInt = 0;
        hijackVideo();
        applyVideoTransform();
        isLocked = true;

        moveHandle.style.background = 'rgba(43, 226, 43, 0.9)';
        moveHandle.innerText = TEXT_LOCKED;
        setStyles(moveHandle, { cursor: 'grab' });

        currentOpacityInt = 100;
        setStyles(activeVideo, { 'opacity': '1' });

        updateHandlesPosition();
        applyUiVisibility(true);

        requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); });
    }

    function isHoveringHandles(e) {
        return e.target === moveHandle || Object.values(cornerHandles).includes(e.target);
    }

    window.addEventListener('mousemove', (e) => {
        if (document.fullscreenElement) { applyUiVisibility(false); return; }

        if (isResizing || isMoving) {
            latestMouseEvent = e;
            if (!ticking) {
                requestAnimationFrame(() => {
                    if (isResizing) executeResize(latestMouseEvent);
                    if (isMoving) executeMove(latestMouseEvent);
                    ticking = false;
                });
                ticking = true;
            }
            applyUiVisibility(true);
            return;
        }

        const isOverHandles = isHoveringHandles(e);

        if (isLocked) {
            if (!activeVideo || !document.body.contains(activeVideo)) { unlockPlayer(); return; }
            updateHandlesPosition();

            const vRect = getVideoBounds(activeVideo);
            const isMouseOverPlayer = (
                e.clientX >= vRect.left && e.clientX <= vRect.right &&
                e.clientY >= vRect.top && e.clientY <= vRect.bottom
            );

            const _show = isMouseOverPlayer || isOverHandles;
            applyUiVisibility(_show);
            if (_show) ytShowOverlay(); else ytHideOverlay();
            return;
        }

        if (isOverHandles && activeVideo && document.body.contains(activeVideo)) {
            applyUiVisibility(true);
            return;
        }

        let found = false;

        if (videos.length === 0) updateVideosList();

        for (let v of videos) {
            if (!document.body.contains(v)) continue;
            const vRect = getVideoBounds(v);

            if (vRect.width < 50 || vRect.height < 50) continue;

            const isMouseOverVideo = (
                e.clientX >= vRect.left && e.clientX <= vRect.right &&
                e.clientY >= vRect.top && e.clientY <= vRect.bottom
            );

            if (isMouseOverVideo) {
                activeVideo = v;
                updateHandlesPosition();
                found = true;
                break;
            }
        }

        if (!found) { activeVideo = null; }
        applyUiVisibility(found);
    });

    window.addEventListener('keydown', (e) => {
        if (!e.ctrlKey) return;
        if (e.code === 'Space' && (activeVideo || isLocked)) {
            e.preventDefault(); isLocked ? unlockPlayer() : lockPlayer();
        } else if (e.code === 'KeyR' && isLocked) {
            e.preventDefault(); unlockPlayer();
        } else if (e.code === 'KeyH' && (isLocked || activeVideo)) {
            e.preventDefault(); isUiGloballyHidden = !isUiGloballyHidden; applyUiVisibility(!!activeVideo);
        } else if (e.code === 'ArrowUp' && isLocked) {
            e.preventDefault(); changeOpacity(10);
        } else if (e.code === 'ArrowDown' && isLocked) {
            e.preventDefault(); changeOpacity(-10);
        } else if (e.code === 'ArrowRight' && isLocked) {
            e.preventDefault(); changeRotation(90);
        } else if (e.code === 'ArrowLeft' && isLocked) {
            e.preventDefault(); changeRotation(-90);
        }
    });

    function changeOpacity(deltaInt) {
        if (!activeVideo || !isLocked) return;
        currentOpacityInt = Math.max(10, Math.min(100, currentOpacityInt + deltaInt));
        setStyles(activeVideo, { 'opacity': (currentOpacityInt / 100).toString() });
        showTemporaryMessage(`Opacity: ${currentOpacityInt}%`);
    }

    function changeRotation(deltaInt) {
        if (!activeVideo || !isLocked) return;
        currentRotationInt = (currentRotationInt + deltaInt) % 360;
        if (currentRotationInt < 0) currentRotationInt += 360;

        applyVideoTransform();
        showTemporaryMessage(`Rotate: ${currentRotationInt}°`);
    }

    moveHandle.addEventListener('wheel', (e) => {
        if (!activeVideo || !isLocked) return;
        e.preventDefault();
        changeOpacity(e.deltaY < 0 ? 10 : -10);
    });

    function executeResize(e) {
        if (!originalVideoRect || !activeCorner) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let deltaW = 0;

        if (activeCorner === 'TL') deltaW = Math.abs(dx) > Math.abs(dy) ? -dx : -dy * originalVideoRect.aspectRatio;
        else if (activeCorner === 'TR') deltaW = Math.abs(dx) > Math.abs(dy) ? dx : -dy * originalVideoRect.aspectRatio;
        else if (activeCorner === 'BL') deltaW = Math.abs(dx) > Math.abs(dy) ? -dx : dy * originalVideoRect.aspectRatio;
        else if (activeCorner === 'BR') deltaW = Math.abs(dx) > Math.abs(dy) ? dx : dy * originalVideoRect.aspectRatio;

        let newWidth = Math.max(100, startWidth + deltaW);
        let newHeight = newWidth / originalVideoRect.aspectRatio;

        let newLeft = startLeft;
        let newTop = startTop;

        if (activeCorner === 'TL') {
            newLeft = startLeft + (startWidth - newWidth);
            newTop = startTop + (startHeight - newHeight);
        } else if (activeCorner === 'TR') {
            newTop = startTop + (startHeight - newHeight);
        } else if (activeCorner === 'BL') {
            newLeft = startLeft + (startWidth - newWidth);
        }

        setStyles(activeVideo, {
            'width': `${Math.round(newWidth)}px`,
            'height': `${Math.round(newHeight)}px`,
            'left': `${Math.round(newLeft)}px`,
            'top': `${Math.round(newTop)}px`
        });

        applyVideoTransform();
        updateHandlesPosition();
        if (syncOverlayPosition) syncOverlayPosition();
        window.dispatchEvent(new Event('resize'));
    }

    moveHandle.addEventListener('click', () => { if (activeVideo && !isLocked) lockPlayer(); });

    moveHandle.addEventListener('mousedown', (e) => {
        if (!activeVideo || !isLocked) return;
        isMoving = true;
        setStyles(moveHandle, { cursor: 'grabbing', opacity: '1' });

        const bounds = getVideoBounds(activeVideo);
        const currentLeft = parseFloat(activeVideo.style.left) || bounds.left;
        const currentTop = parseFloat(activeVideo.style.top) || bounds.top;

        moveOffsetX = e.clientX - currentLeft;
        moveOffsetY = e.clientY - currentTop;
        e.preventDefault();
    });

    function executeMove(e) {
        setStyles(activeVideo, {
            'left': `${Math.round(e.clientX - moveOffsetX)}px`,
            'top': `${Math.round(e.clientY - moveOffsetY)}px`
        });
        updateHandlesPosition();
        if (syncOverlayPosition) syncOverlayPosition();
    }

    function unlockPlayer() {
        if (!activeVideo || !isLocked) return;

        const isStillInDOM = document.body.contains(activeVideo);

        boostedParents.forEach(item => {
            if (item.element) {
                if (item.originalZ) item.element.style.setProperty('z-index', item.originalZ);
                else item.element.style.removeProperty('z-index');
            }
        });
        boostedParents = [];

        propsToHijack.forEach(prop => {
            if (savedInlineStyles[prop] !== null && savedInlineStyles[prop] !== undefined) {
                activeVideo.style.setProperty(prop, savedInlineStyles[prop], savedInlineStyles[prop + '_priority']);
            } else {
                activeVideo.style.removeProperty(prop);
            }
        });

        activeVideo.style.removeProperty('object-fit');
        activeVideo.dataset.hijacked = "false";
        isLocked = false;
        currentRotationInt = 0;
        originalVideoRect = null;
        ytHideOverlay();

        moveHandle.style.background = 'rgba(226, 43, 43, 0.9)';
        moveHandle.innerText = TEXT_DRAG;
        setStyles(moveHandle, { cursor: 'pointer' });

        clearTimeout(tempMsgTimeout);

        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
            if (isStillInDOM) {
                updateHandlesPosition();
                applyUiVisibility(true);
            } else {
                activeVideo = null;
                applyUiVisibility(false);
            }
        });
    }

    moveHandle.addEventListener('dblclick', () => unlockPlayer());

    const detachPlayer = () => unlockPlayer();
    window.addEventListener('popstate', detachPlayer);
    window.addEventListener('yt-navigate-finish', detachPlayer);

    setInterval(() => {
        if (activeVideo && !document.body.contains(activeVideo)) {
            if (isLocked) unlockPlayer();
            else { activeVideo = null; applyUiVisibility(false); }
        }
    }, 1000);

    let resizeTicking = false;
    window.addEventListener('resize', () => {
        if (!isLocked || !activeVideo) return;
        if (!resizeTicking) {
            requestAnimationFrame(() => { 
                updateHandlesPosition(); 
                if (syncOverlayPosition) syncOverlayPosition();
                resizeTicking = false; 
            });
            resizeTicking = true;
        }
    });

    const stopDrag = (e) => {
        if (isResizing || isMoving) {
            window.dispatchEvent(new Event('resize'));
        }
        isResizing = false; isMoving = false;
        activeCorner = null;

        if (isLocked) setStyles(moveHandle, { cursor: 'grab' });

        if (e && !isHoveringHandles(e)) {
            setStyles(moveHandle, { opacity: '0.4' });
        }

        applyUiVisibility(!!activeVideo);
    };

    window.addEventListener('mouseup', stopDrag);
    document.addEventListener('mouseleave', stopDrag);

    // ── YouTube-style overlay ─────────────────────────────────
    function _el(tag, css) {
        const e = document.createElement(tag);
        if (css) e.style.cssText = css;
        return e;
    }
    function _svg(pathD, w, h) {
        const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
        s.setAttribute('width', w||22); s.setAttribute('height', h||22);
        s.setAttribute('viewBox','0 0 24 24');
        const p = document.createElementNS('http://www.w3.org/2000/svg','path');
        p.setAttribute('fill','white'); p.setAttribute('d', pathD);
        s.appendChild(p); return {svg:s, path:p};
    }

    const _ov = _el('div',`position:fixed;display:none;pointer-events:none;box-sizing:border-box;overflow:hidden;z-index:${Z_OVERLAY};`);
    document.documentElement.appendChild(_ov);

    const _big = _el('div','position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.65);border:2px solid rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;box-sizing:border-box;transition:background .15s,transform .1s;');
    const _bigSvg = _svg('M8 5v14l11-7z', 28, 28);
    _big.appendChild(_bigSvg.svg);
    _big.addEventListener('mouseenter',()=>{_big.style.background='rgba(200,0,0,.85)';_big.style.transform='translate(-50%,-50%) scale(1.08)';});
    _big.addEventListener('mouseleave',()=>{_big.style.background='rgba(0,0,0,.65)';_big.style.transform='translate(-50%,-50%) scale(1)';});
    _ov.appendChild(_big);

    const _bar = _el('div','position:absolute;bottom:0;left:0;right:0;padding:30px 12px 8px;background:linear-gradient(transparent,rgba(0,0,0,.85));display:flex;flex-direction:column;gap:7px;pointer-events:auto;box-sizing:border-box;');

    const _pt = _el('div','width:100%;height:4px;background:rgba(255,255,255,.25);border-radius:2px;cursor:pointer;position:relative;flex-shrink:0;transition:height .1s;');
    const _pf = _el('div','height:100%;background:#f00;border-radius:2px;width:0%;position:relative;');
    const _pd = _el('div','position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:13px;height:13px;background:#f00;border-radius:50%;opacity:0;transition:opacity .15s;');
    _pf.appendChild(_pd); _pt.appendChild(_pf); _bar.appendChild(_pt);
    _pt.addEventListener('mouseenter',()=>{_pt.style.height='7px';_pd.style.opacity='1';});
    _pt.addEventListener('mouseleave',()=>{_pt.style.height='4px';_pd.style.opacity='0';});

    const _row = _el('div','display:flex;align-items:center;gap:6px;');

    function _btn(pathD) {
        const d = _el('div','cursor:pointer;display:flex;align-items:center;padding:3px;pointer-events:auto;flex-shrink:0;opacity:.85;transition:opacity .15s;');
        d.addEventListener('mouseenter',()=>d.style.opacity='1');
        d.addEventListener('mouseleave',()=>d.style.opacity='.85');
        const sv = _svg(pathD);
        d.appendChild(sv.svg);
        return {el:d, path:sv.path};
    }

    const PLAY_D  = 'M8 5v14l11-7z';
    const PAUSE_D = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
    const VOL_HI  = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
    const VOL_LO  = 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z';
    const VOL_MU  = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
    const FS_D    = 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z';
    
    const PREV_D  = 'M6 6h2v12H6zm3.5 6l8.5 6V6z';
    const NEXT_D  = 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z';

    const _prevbtn = _btn(PREV_D);
    const _pbtn = _btn(PLAY_D);
    const _nextbtn = _btn(NEXT_D);
    const _vbtn = _btn(VOL_HI);

    const _vt = _el('div','width:70px;height:4px;background:rgba(255,255,255,.25);border-radius:2px;cursor:pointer;flex-shrink:0;pointer-events:auto;position:relative;');
    const _vf = _el('div','height:100%;background:#fff;border-radius:2px;width:100%;');
    _vt.appendChild(_vf);

    const _tm = _el('span','color:#fff;font:bold 12px/1 Arial,sans-serif;white-space:nowrap;flex-shrink:0;margin-left:4px;');
    _tm.textContent = '0:00 / 0:00';

    const _sp = _el('div','flex:1;');

    const _fsbtn = _btn(FS_D);

    _row.appendChild(_prevbtn.el);
    _row.appendChild(_pbtn.el);
    _row.appendChild(_nextbtn.el);
    _row.appendChild(_vbtn.el); 
    _row.appendChild(_vt);
    _row.appendChild(_tm); 
    _row.appendChild(_sp); 
    _row.appendChild(_fsbtn.el);
    
    _bar.appendChild(_row);
    _ov.appendChild(_bar);

    _prevbtn.el.addEventListener('click', (e) => {
        e.stopPropagation();
        if(!activeVideo) return;
        activeVideo.currentTime = 0;
        _syncProg();
    });

    _nextbtn.el.addEventListener('click', (e) => {
        e.stopPropagation();
        if(!activeVideo) return;
        if(activeVideo.duration) {
            activeVideo.currentTime = Math.max(0, activeVideo.duration - 0.5);
        }
    });

    function _fmt(s, forceH = false) {
        if (!s || isNaN(s)) return forceH ? '0:00:00' : '0:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        
        if (h > 0 || forceH) {
            return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        }
        return m + ':' + String(sec).padStart(2, '0');
    }

    function _syncPlay(){
        const p=!activeVideo||activeVideo.paused;
        _bigSvg.path.setAttribute('d',p?PLAY_D:PAUSE_D);
        _pbtn.path.setAttribute('d',p?PLAY_D:PAUSE_D);
    }
    function _syncVol(){
        if(!activeVideo)return;
        const m=activeVideo.muted||activeVideo.volume===0, lo=!m&&activeVideo.volume<0.5;
        _vbtn.path.setAttribute('d',m?VOL_MU:lo?VOL_LO:VOL_HI);
        _vf.style.width=(m?0:activeVideo.volume*100)+'%';
    }
    
    function _syncPos(){
        if(!activeVideo)return;
        const b = getVideoBounds(activeVideo);
        _ov.style.left = b.left + 'px'; 
        _ov.style.top = b.top + 'px';
        _ov.style.width = b.width + 'px'; 
        _ov.style.height = b.height + 'px';
    }
    syncOverlayPosition = _syncPos;

    function _syncProg(){
        if(!activeVideo)return;
        const d = activeVideo.duration || 0;
        const c = activeVideo.currentTime || 0;
        const pct = d ? (c / d * 100) : 0;
        _pf.style.width = pct + '%';
        
        const forceH = d >= 3600;
        _tm.textContent = _fmt(c, forceH) + ' / ' + _fmt(d);
    }

    let _raf=null;
    function _tick(){ _syncPos(); _syncProg(); _raf=requestAnimationFrame(_tick); }

    function ytShowOverlay(){
        if(!activeVideo||!isLocked)return;
        if(_ov.style.display==='block')return;
        _syncPos(); _syncPlay(); _syncVol();
        _ov.style.display='block';
        if(!_raf)_tick();
    }
    function ytHideOverlay(){
        _ov.style.display='none';
        if(_raf){cancelAnimationFrame(_raf);_raf=null;}
    }

    function _togglePlay(e){
        e.stopPropagation();
        if(!activeVideo)return;
        activeVideo.paused?activeVideo.play():activeVideo.pause();
        _syncPlay();
    }
    _big.addEventListener('click',_togglePlay);
    _pbtn.el.addEventListener('click',_togglePlay);
    _vbtn.el.addEventListener('click',(e)=>{e.stopPropagation();if(!activeVideo)return;activeVideo.muted=!activeVideo.muted;_syncVol();});
    _vt.addEventListener('click',(e)=>{
        e.stopPropagation();if(!activeVideo)return;
        const r=_vt.getBoundingClientRect();
        const v=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
        activeVideo.volume=v;activeVideo.muted=v===0;_syncVol();
    });
    _pt.addEventListener('click',(e)=>{
        e.stopPropagation();if(!activeVideo||!activeVideo.duration)return;
        const r=_pt.getBoundingClientRect();
        activeVideo.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*activeVideo.duration;
    });
    _fsbtn.el.addEventListener('click',(e)=>{
        e.stopPropagation();if(!activeVideo)return;
        document.fullscreenElement?document.exitFullscreen():activeVideo.requestFullscreen().catch(()=>{});
    });
    document.addEventListener('play', _syncPlay,true);
    document.addEventListener('pause',_syncPlay,true);
    _ov.addEventListener('mousemove',(e)=>{e.stopPropagation();if(isLocked&&activeVideo)ytShowOverlay();});
})();
