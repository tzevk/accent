'use client';

import { useEffect } from 'react';

/**
 * Custom hook to enable spell check on all text inputs and textareas
 * This runs once on mount and sets up a MutationObserver to catch dynamically added elements
 */
export function useSpellCheck() {
  useEffect(() => {
    // Function to enable spell check on an element
    const enableSpellCheck = (element) => {
      if (
        element.tagName === 'INPUT' && 
        ['text', 'email', 'search', ''].includes(element.type || '')
      ) {
        element.spellcheck = true;
      } else if (element.tagName === 'TEXTAREA') {
        element.spellcheck = true;
      } else if (element.contentEditable === 'true') {
        element.spellcheck = true;
      }
    };

    // Enable spell check on all existing inputs
    const enableAllSpellChecks = () => {
      document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]').forEach(enableSpellCheck);
    };

    // Run initially
    enableAllSpellChecks();

    // Set up MutationObserver to catch dynamically added elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node itself is an input/textarea
            enableSpellCheck(node);
            // Check children of the added node
            node.querySelectorAll?.('input[type="text"], input[type="email"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]')?.forEach(enableSpellCheck);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, []);
}

/**
 * SpellCheck component wrapper - add this to your root layout
 * to enable spell check throughout the app
 */
export function SpellCheckProvider({ children }) {
  useSpellCheck();
  return children;
}

export default useSpellCheck;
