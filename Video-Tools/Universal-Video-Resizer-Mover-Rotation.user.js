// ==UserScript==
// @name         Universal Video Resizer & Mover & Rotation
// @namespace    http://tampermonkey.net/
// @version      16.1
// @description  Zero Auto-Resize, Render Bug Fix, Persistent Handles + Rotate Video Picture Only (Keep UI Intact).
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
    const Z_PLAYER = '2147483646';
    const Z_PARENTS = '2147483645';

    const inIframe = window.self !== window.top;
    const TEXT_DRAG = inIframe ? "DRAG [F]" : "DRAG";
    const TEXT_LOCKED = inIframe ? "LOCKED [F]" : "LOCKED";

    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = `
        position: fixed; width: 35px; height: 35px;
        cursor: nwse-resize; z-index: ${Z_HANDLES};
        background: linear-gradient(135deg, transparent 50%, rgba(226, 43, 43, 0.9) 50%);
        pointer-events: auto; display: none; transition: opacity 0.3s;
        opacity: 0.4; border-radius: 0 0 5px 0;
    `;

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

    document.body.appendChild(resizeHandle);
    document.body.appendChild(moveHandle);

    resizeHandle.addEventListener('mouseenter', () => { if (!isUiGloballyHidden && !isUiAutoHidden) resizeHandle.style.opacity = '1'; });
    resizeHandle.addEventListener('mouseleave', () => { if (!isResizing && !isUiGloballyHidden && !isUiAutoHidden) resizeHandle.style.opacity = '0.4'; });
    moveHandle.addEventListener('mouseenter', () => { if (!isUiGloballyHidden && !isUiAutoHidden) moveHandle.style.opacity = '1'; });
    moveHandle.addEventListener('mouseleave', () => { if (!isMoving && !isUiGloballyHidden && !isUiAutoHidden) moveHandle.style.opacity = '0.4'; });

    let videos = [];
    let activeVideo = null;
    let targetWrapper = null;
    let isResizing = false;
    let isMoving = false;
    let isLocked = false;

    let isUiGloballyHidden = false;
    let isUiAutoHidden = false;
    let uiHideTimer = null;
    let tempMsgTimeout = null;

    let startX, startY, startWidth, startHeight;
    let currentOpacityInt = 100;
    let currentRotationInt = 0; 
    let moveOffsetX, moveOffsetY;

    let ticking = false;
    let latestMouseEvent = null;

    let savedInlineStyles = {};
    let boostedParents = [];
    const propsToHijack = ['position', 'z-index', 'left', 'top', 'margin', 'width', 'height', 'max-width', 'max-height', 'transition', 'opacity', 'transform'];

    function setStyles(el, styles) {
        if (!el) return;
        for (const [prop, val] of Object.entries(styles)) {
            el.style.setProperty(prop, val, 'important');
        }
    }

    function showTemporaryMessage(msg, duration = 1000) {
        moveHandle.innerText = msg;
        clearTimeout(tempMsgTimeout);
        tempMsgTimeout = setTimeout(() => {
            moveHandle.innerText = isLocked ? TEXT_LOCKED : TEXT_DRAG;
        }, duration);
    }

    function applyUiVisibility(hoverFound = false) {
        if (isUiGloballyHidden) {
            resizeHandle.style.display = 'none'; moveHandle.style.display = 'none'; return;
        }

        if (isLocked) {
            resizeHandle.style.display = 'block'; moveHandle.style.display = 'block';
            if (isUiAutoHidden) {
                setStyles(resizeHandle, { 'opacity': '0', 'pointer-events': 'none' });
                setStyles(moveHandle, { 'opacity': '0', 'pointer-events': 'none' });
            } else {
                setStyles(resizeHandle, { 'opacity': isResizing ? '1' : '0.4', 'pointer-events': 'auto' });
                setStyles(moveHandle, { 'opacity': isMoving ? '1' : '0.4', 'pointer-events': 'auto' });
            }
        } else {
            if (hoverFound) {
                resizeHandle.style.display = 'block'; moveHandle.style.display = 'block';
                setStyles(resizeHandle, { 'opacity': '0.4', 'pointer-events': 'auto' });
                setStyles(moveHandle, { 'opacity': '0.4', 'pointer-events': 'auto' });
            } else {
                resizeHandle.style.display = 'none'; moveHandle.style.display = 'none';
            }
        }
    }

    function updateVideosList() {
        videos = Array.from(document.querySelectorAll('video')).filter(v => {
            const rect = v.getBoundingClientRect(); return rect.width > 50 && rect.height > 50;
        });
    }

    const observer = new MutationObserver((mutations) => {
        if (isLocked) return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1 && (node.tagName === 'VIDEO' || node.querySelector('video'))) updateVideosList();
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    updateVideosList();

    function getResizableElement(video) {
        const knownSelectors = ['.html5-video-player', '.d-video-player', '.yandex-music-video-player', '.video-player', '.plyr', '.vjs-default-skin', '[data-vjs-player]', '.player-wrapper', '.artplayer-app', '.kinopoisk-player'];
        for (let sel of knownSelectors) {
            let closest = video.closest(sel); if (closest) return closest;
        }

        let current = video, target = video, depth = 0;
        const vRect = video.getBoundingClientRect();
        while (current && current !== document.body && depth < 8) {
            const rect = current.getBoundingClientRect();
            if (rect.width <= vRect.width + 200 && rect.height <= vRect.height + 250) target = current;
            else break;
            current = current.parentElement; depth++;
        }
        return target;
    }

    function updateHandlesPosition() {
        if (!targetWrapper || !document.body.contains(targetWrapper)) return;
        const rect = targetWrapper.getBoundingClientRect();
        setStyles(resizeHandle, { left: `${Math.round(rect.right - 35)}px`, top: `${Math.round(rect.bottom - 35)}px` });
        setStyles(moveHandle, { left: `${Math.round(rect.left + (rect.width / 2) - 42)}px`, top: `${Math.round(rect.top)}px` });
    }

    function hijackPlayer() {
        if (targetWrapper.dataset.hijacked === "true") return;

        savedInlineStyles = {};
        propsToHijack.forEach(prop => {
            savedInlineStyles[prop] = targetWrapper.style.getPropertyValue(prop);
            savedInlineStyles[prop + '_priority'] = targetWrapper.style.getPropertyPriority(prop);
        });

        const rect = targetWrapper.getBoundingClientRect();

        setStyles(targetWrapper, {
            'transition': 'none', 'position': 'fixed', 'z-index': Z_PLAYER,
            'left': `${Math.round(rect.left)}px`, 'top': `${Math.round(rect.top)}px`,
            'width': `${Math.round(rect.width)}px`, 'height': `${Math.round(rect.height)}px`,
            'margin': '0', 'max-width': 'none', 'max-height': 'none', 'transform': 'none'
        });

        setStyles(activeVideo, { 'width': '100%', 'height': '100%' });

        let p = targetWrapper.parentElement;
        while(p && p !== document.body && p !== document.documentElement) {
            if (!boostedParents.some(item => item.element === p)) {
                boostedParents.push({ element: p, originalZ: p.style.zIndex });
                p.style.setProperty('z-index', Z_PARENTS, 'important');
            }
            p = p.parentElement;
        }
        targetWrapper.dataset.hijacked = "true";
        void targetWrapper.offsetHeight;
    }

    function applyVideoTransform() {
        if (!activeVideo || !targetWrapper) return;

        let scale = 1;
        if (currentRotationInt % 180 !== 0) {
            const w = targetWrapper.offsetWidth;
            const h = targetWrapper.offsetHeight;
            if (h > 0 && w > 0) {
                scale = Math.min(w / h, h / w);
            }
        }

        setStyles(activeVideo, {
            'transform': `rotate(${currentRotationInt}deg) scale(${scale})`,
            'transform-origin': 'center center'
        });
    }

    function lockPlayer() {
        if (isLocked || !targetWrapper) return;
        
        currentRotationInt = 0; 
        hijackPlayer();
        applyVideoTransform();
        isLocked = true;

        moveHandle.style.background = 'rgba(43, 226, 43, 0.9)';
        moveHandle.innerText = TEXT_LOCKED;
        moveHandle.style.cursor = 'grab';

        currentOpacityInt = 100;

        isUiAutoHidden = false;
        updateHandlesPosition();
        applyUiVisibility();

        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
        });
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
            return;
        }

        if (e.target === resizeHandle || e.target === moveHandle) return;

        if (isLocked) {
            if (!targetWrapper || !document.body.contains(targetWrapper)) { unlockPlayer(); return; }
            updateHandlesPosition();

            const twRect = targetWrapper.getBoundingClientRect();
            const isMouseOverPlayer = (e.clientX >= twRect.left && e.clientX <= twRect.right && e.clientY >= twRect.top && e.clientY <= twRect.bottom);

            if (isMouseOverPlayer || isResizing || isMoving) {
                isUiAutoHidden = false;
                clearTimeout(uiHideTimer);
                uiHideTimer = setTimeout(() => {
                    if (!isResizing && !isMoving) { isUiAutoHidden = true; applyUiVisibility(); }
                }, 2000);
            } else {
                if (!isResizing && !isMoving) { isUiAutoHidden = true; clearTimeout(uiHideTimer); }
            }
            applyUiVisibility(); return;
        }

        let found = false;
        for (let v of videos) {
            if (!document.body.contains(v)) continue;
            const tw = (targetWrapper && targetWrapper.contains(v)) ? targetWrapper : getResizableElement(v);
            const twRect = tw.getBoundingClientRect();

            const isMouseOverVideo = (e.clientX >= twRect.left && e.clientX <= twRect.right && e.clientY >= twRect.top && e.clientY <= twRect.bottom);

            if (isMouseOverVideo) {
                targetWrapper = tw; activeVideo = v;
                updateHandlesPosition(); found = true; break;
            }
        }

        if (!found) { activeVideo = null; targetWrapper = null; }
        applyUiVisibility(found);
    });

    window.addEventListener('keydown', (e) => {
        if (!e.ctrlKey) return;

        if (e.code === 'Space' && (targetWrapper || isLocked)) {
            e.preventDefault(); isLocked ? unlockPlayer() : lockPlayer();
        } else if (e.code === 'KeyR' && isLocked) {
            e.preventDefault(); unlockPlayer();
        } else if (e.code === 'KeyH' && (isLocked || targetWrapper)) {
            e.preventDefault(); isUiGloballyHidden = !isUiGloballyHidden; applyUiVisibility(!!targetWrapper);
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
        if (!targetWrapper || !isLocked) return;
        currentOpacityInt = Math.max(10, Math.min(100, currentOpacityInt + deltaInt));
        setStyles(targetWrapper, { 'opacity': (currentOpacityInt / 100).toString() });
        showTemporaryMessage(`Opacity: ${currentOpacityInt}%`);
    }

    function changeRotation(deltaInt) {
        if (!targetWrapper || !isLocked) return;
        currentRotationInt = (currentRotationInt + deltaInt) % 360;
        if (currentRotationInt < 0) currentRotationInt += 360;
        
        applyVideoTransform();
        showTemporaryMessage(`Rotate: ${currentRotationInt}°`);
    }

    moveHandle.addEventListener('wheel', (e) => {
        if (!targetWrapper || !isLocked) return;
        e.preventDefault();
        changeOpacity(e.deltaY < 0 ? 10 : -10);
    });

    resizeHandle.addEventListener('mousedown', (e) => {
        if (!targetWrapper) return;
        if (!isLocked) lockPlayer();

        isResizing = true;
        resizeHandle.style.opacity = '1';
        startX = e.clientX; startY = e.clientY;

        startWidth = targetWrapper.offsetWidth;
        startHeight = targetWrapper.offsetHeight;
        e.preventDefault();
    });

    function executeResize(e) {
        const dx = e.clientX - startX; const dy = e.clientY - startY;
        const dotProduct = (startWidth * (startWidth + dx)) + (startHeight * (startHeight + dy));
        const uLengthSquared = (startWidth * startWidth) + (startHeight * startHeight);
        let scale = Math.max(250 / startWidth, dotProduct / uLengthSquared);

        setStyles(targetWrapper, {
            'width': `${Math.round(startWidth * scale)}px`,
            'height': `${Math.round(startHeight * scale)}px`
        });

        applyVideoTransform();

        window.dispatchEvent(new Event('resize'));
        updateHandlesPosition();
    }

    moveHandle.addEventListener('click', () => { if (targetWrapper && !isLocked) lockPlayer(); });

    moveHandle.addEventListener('mousedown', (e) => {
        if (!targetWrapper || !isLocked) return;
        isMoving = true; moveHandle.style.cursor = 'grabbing';
        
        const currentLeft = parseFloat(targetWrapper.style.left) || targetWrapper.getBoundingClientRect().left;
        const currentTop = parseFloat(targetWrapper.style.top) || targetWrapper.getBoundingClientRect().top;
        
        moveOffsetX = e.clientX - currentLeft; 
        moveOffsetY = e.clientY - currentTop;
        e.preventDefault();
    });

    function executeMove(e) {
        setStyles(targetWrapper, {
            'left': `${Math.round(e.clientX - moveOffsetX)}px`,
            'top': `${Math.round(e.clientY - moveOffsetY)}px`
        });
        updateHandlesPosition();
    }

    function unlockPlayer() {
        if (!targetWrapper || !isLocked) return;

        const isStillInDOM = document.body.contains(targetWrapper);

        boostedParents.forEach(item => {
            if (item.element) {
                if (item.originalZ) item.element.style.setProperty('z-index', item.originalZ);
                else item.element.style.removeProperty('z-index');
            }
        });
        boostedParents = [];

        propsToHijack.forEach(prop => {
            if (savedInlineStyles[prop]) targetWrapper.style.setProperty(prop, savedInlineStyles[prop], savedInlineStyles[prop + '_priority']);
            else targetWrapper.style.removeProperty(prop);
        });

        if (activeVideo) {
            activeVideo.style.removeProperty('transform');
            activeVideo.style.removeProperty('transform-origin');
        }

        targetWrapper.dataset.hijacked = "false";
        isLocked = false;
        currentRotationInt = 0; 

        moveHandle.style.background = 'rgba(226, 43, 43, 0.9)';
        moveHandle.innerText = TEXT_DRAG;
        moveHandle.style.cursor = 'pointer';

        clearTimeout(uiHideTimer); clearTimeout(tempMsgTimeout);
        isUiAutoHidden = false;

        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
            if (isStillInDOM) {
                updateHandlesPosition();
                applyUiVisibility(true);
            } else {
                activeVideo = null; targetWrapper = null;
                applyUiVisibility(false);
            }
        });
    }

    moveHandle.addEventListener('dblclick', () => unlockPlayer());

    const detachPlayer = () => unlockPlayer();
    window.addEventListener('popstate', detachPlayer);
    window.addEventListener('yt-navigate-finish', detachPlayer);

    setInterval(() => {
        if (isLocked && targetWrapper && !document.body.contains(targetWrapper)) unlockPlayer();
    }, 1000);

    let resizeTicking = false;
    window.addEventListener('resize', () => {
        if (!isLocked || !targetWrapper) return;
        if (!resizeTicking) {
            requestAnimationFrame(() => { updateHandlesPosition(); resizeTicking = false; });
            resizeTicking = true;
        }
    });

    const stopDrag = () => {
        if (isResizing || isMoving) {
            window.dispatchEvent(new Event('resize'));
        }
        isResizing = false; isMoving = false;
        if (isLocked) moveHandle.style.cursor = 'grab';
        applyUiVisibility(!!targetWrapper);
    };

    window.addEventListener('mouseup', stopDrag);
    document.addEventListener('mouseleave', stopDrag);

})();