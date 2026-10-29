// ==UserScript==
// @name         Advanced Dialog Control (Alert, Confirm, Prompt)
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Replaces window.alert with a smart dialog, and adds rapid-fire protection to confirm() and prompt() for broken/nefarious sites.
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    // The time window in milliseconds to consider calls as "rapid-fire".
    const RAPID_FIRE_DEBOUNCE_MS = 300;
    // The number of calls within the time window to trigger the circuit breaker for confirm/prompt.
    const RAPID_FIRE_CALL_THRESHOLD = 3;
    // For alert summaries: the max number of unique messages to show in the dialog.
    const MAX_MESSAGES_IN_ALERT_SUMMARY = 5;


    // --- Store Original Functions ---
    // We must keep a reference to the original functions to call them when not in a rapid-fire state.
    const originalConfirm = window.confirm;
    const originalPrompt = window.prompt;


    // ===================================================================
    //  1. ADVANCED ALERT REPLACEMENT (Asynchronous with Dialog)
    // ===================================================================
    let alertProcessingTimer = null;
    let collectedAlertMessages = [];
    let dialogElement = null;
    let isDialogReady = false;

    // The replacement function for window.alert
    window.alert = function(message) {
        console.log(`Tampermonkey intercepted alert: "${message}"`);

        if (message && message.match(/internet explorer/i)) {
            console.log("Ignoring IE-related alert.");
            return;
        }

        collectedAlertMessages.push(message);
        if (alertProcessingTimer) clearTimeout(alertProcessingTimer);
        alertProcessingTimer = setTimeout(processCollectedAlerts, RAPID_FIRE_DEBOUNCE_MS);
    };
    console.log("Tampermonkey Advanced Dialog Control done early init.");

    function processCollectedAlerts() {
        if (!isDialogReady || collectedAlertMessages.length === 0) return;

        if (collectedAlertMessages.length === 1) {
            showAlertDialog('Alert Message', collectedAlertMessages[0].replace(/\n/g, '<br>'));
        } else {
            const totalCount = collectedAlertMessages.length;
            const uniqueMessages = [...new Set(collectedAlertMessages)];
            let summary = `<b>Total Alerts: ${totalCount}</b> (${uniqueMessages.length} unique)<br><hr>`;
            for (let i = 0; i < Math.min(uniqueMessages.length, MAX_MESSAGES_IN_ALERT_SUMMARY); i++) {
                const escaped = uniqueMessages[i].replace(/</g, "&lt;").replace(/>/g, "&gt;");
                summary += `• ${escaped.replace(/\n/g, "<br>  ")}<br>`;
            }
            if (uniqueMessages.length > MAX_MESSAGES_IN_ALERT_SUMMARY) {
                summary += `...and ${uniqueMessages.length - MAX_MESSAGES_IN_ALERT_SUMMARY} more.`;
            }
            showAlertDialog('Rapid-Fire Alerts Detected', summary);
        }
        collectedAlertMessages = [];
    }

    function showAlertDialog(title, message) {
        if (!dialogElement || dialogElement.open) return;
        dialogElement.querySelector('h3').textContent = title;
        dialogElement.querySelector('p').innerHTML = message;
        dialogElement.showModal();
    }


    // ===================================================================
    //  2. CONFIRM & PROMPT CIRCUIT BREAKER (Synchronous Protection)
    // ===================================================================
    let confirmCallCount = 0;
    let confirmResetTimer = null;
    let promptCallCount = 0;
    let promptResetTimer = null;

    // The replacement function for window.confirm
    window.confirm = function(message) {
        confirmCallCount++;
        if (confirmResetTimer) clearTimeout(confirmResetTimer);
        confirmResetTimer = setTimeout(() => { confirmCallCount = 0; }, RAPID_FIRE_DEBOUNCE_MS * 2);

        if (confirmCallCount >= RAPID_FIRE_CALL_THRESHOLD) {
            // --- CIRCUIT BREAKER TRIGGERED ---
            if (confirmCallCount === RAPID_FIRE_CALL_THRESHOLD) {
                // Log only on the first blocked call to avoid spamming the console
                console.warn(`Rapid-fire window.confirm detected. Automatically returning "false" to prevent loop. Message: "${message}"`);
            }
            return false; // Return the "safe" default to cancel the action.
        }

        // If not rapid-fire, call the original native confirm dialog.
        return originalConfirm.apply(window, arguments);
    };

    // The replacement function for window.prompt
    window.prompt = function(message, defaultValue) {
        promptCallCount++;
        if (promptResetTimer) clearTimeout(promptResetTimer);
        promptResetTimer = setTimeout(() => { promptCallCount = 0; }, RAPID_FIRE_DEBOUNCE_MS * 2);

        if (promptCallCount >= RAPID_FIRE_CALL_THRESHOLD) {
            // --- CIRCUIT BREAKER TRIGGERED ---
            if (promptCallCount === RAPID_FIRE_CALL_THRESHOLD) {
                console.warn(`Rapid-fire window.prompt detected. Automatically returning "null" to prevent loop. Message: "${message}"`);
            }
            return null; // Return the "safe" default, same as clicking "Cancel".
        }

        // If not rapid-fire, call the original native prompt dialog.
        return originalPrompt.apply(window, arguments);
    };


    // ===================================================================
    //  3. DOM INITIALIZATION (For Alert Dialog Only)
    // ===================================================================
    document.addEventListener('DOMContentLoaded', function() {
        const dialog = document.createElement('dialog');
        dialog.id = 'tampermonkey-alert-dialog';
        dialog.style.cssText = 'z-index: 999999; margin-top: 20px; max-width: 50%; min-width: 300px; border: 1px solid #ccc; border-radius: 8px; background-color: lightyellow;';
        dialog.addEventListener('close', () => {
             // After closing a dialog, check if another batch of alerts needs processing.
             if(collectedAlertMessages.length > 0) {
                 setTimeout(processCollectedAlerts, 50);
             }
        });

        const form = document.createElement('form');
        form.method = 'dialog';
        form.style.fontFamily = 'Helvetica, Arial, sans-serif';
        dialog.appendChild(form);

        const header = document.createElement('h3');
        header.style.marginTop = '0';
        form.appendChild(header);

        const content = document.createElement('p');
        content.style.cssText = 'margin: 1em 0; white-space: pre-wrap; word-break: break-word;';
        form.appendChild(content);

        const buttonWrapper = document.createElement('div');
        buttonWrapper.style.textAlign = 'right';
        form.appendChild(buttonWrapper);

        const okButton = document.createElement('button');
        okButton.textContent = 'OK';
        okButton.style.cssText = 'padding: 8px 16px; color: white; background-color: #1c7cc5; border: none; border-radius: 4px; cursor: pointer;';
        buttonWrapper.appendChild(okButton);

        document.body.appendChild(dialog);
        dialogElement = dialog;
        isDialogReady = true;

        console.log("Tampermonkey Advanced Dialog Control is active.");

        // Process any alerts that were queued before the DOM was ready.
        if (collectedAlertMessages.length > 0) {
            processCollectedAlerts();
        }
    });

})();