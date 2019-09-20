/*
 * Rabbit Lyrics
 *
 * JavaScript audio and timed lyrics synchronizer. No jQuery required.
 *
 * License: GNU General Public License version 3
 * Author: Guo Yunhe <yunhe.guo@protonmail.com>
 * Home page: https://github.com/guoyunhe/rabbit-lyrics
 * Documentation: https://github.com/guoyunhe/rabbit-lyrics/wiki
 * Report bugs: https://github.com/guoyunhe/rabbit-lyrics/issues
 */

import "./index.css";

/**
 * Rabbit Lyrics main class
 *
 * @prop {HTMLElement} element
 * @prop {HTMLMediaElement} mediaElement
 * @prop {HTMLElement[]} lineElements
 * @prop {number} scrollerInterval
 *      Used to force stop previous scroller interval and set new interval
 * @prop {number} scrollerIntervalStep
 *      How long scroller interval should be executed, in milliseconds
 * @prop {number} scrollerIntervalDuration
 *      How long scroller interval could work.
 * @prop {number} scrollerTimer
 *      Countdown timer (ms) for scrolling animation.
 */
export default class RabbitLyrics {
  /**
   * Constructor
   * @param {Object} options
   * @param {HTMLElement} options.element The block this contains lyrics
   * @param {HTMLMediaElement} options.mediaElement The audio or video element to synchronize
   * @param {string} options.viewMode Modes of lyrics view box, available values: default, mini, full
   * @param {string} options.alignment Lyrics text alighment, available values: left, center, right
   * @param {number} options.height Height of lyrics. Only works with default view mode
   * @param {boolean} options.noScroll Auto scroll disable
   * @param {number} options.lyricDelay Delay of lyrics in ms. Can be negative to advance the lyric
   */
  constructor(options) {
    this.element = options.element;

    if (this.element.classList.contains("rabbit-lyrics--enabled")) {
      return;
    }

    this.element.classList.add("rabbit-lyrics");

    if (options.mediaElement) {
      this.mediaElement = options.mediaElement;
    } else {
      this.mediaElement = this.findMediaElementBefore(this.element);
    }

    if (options.viewMode) {
      this.viewMode = options.viewMode;
    } else {
      this.viewMode = "default";
    }
    this.element.classList.add("rabbit-lyrics--" + this.viewMode);

    if (this.viewMode !== "full" && options.height) {
      this.element.style.height = options.height + "px";
    }

    if (options.alignment) {
      this.element.style.textAlign = options.alignment;
    }

    if (options.noScroll) {
      this.element.classList.remove("rabbit-lyrics--scroll");
    } else {
      this.element.classList.add("rabbit-lyrics--scroll");
    }

    if (options.lyricDelay) {
      this.element.dataset.delay=options.lyricDelay;
    } else {
      this.element.dataset.delay=0;
    }

    this.scrollerIntervalDuration = 200;
    this.scrollerIntervalStep = 10;
    this.lineElements = [];

    // Bind this to event handlers
    this.setStatus = this.setStatus.bind(this);
    this.synchronize = this.synchronize.bind(this);
    this.scroll = this.scroll.bind(this);
    this.detachLyrics=this.detachLyrics.bind(this);

    this.parseLyrics();
    this.enableLyrics();
  }
  
  /**
   * Find first audio or video element before lyrics element. Only used when
   * no mediaElement was specified. If nothing was found, return null.
   * @param {HTMLElement} element The start point element
   * @return {HTMLMediaElement|null}
   */
  findMediaElementBefore(element) {
    if (!element) {
      return null;
    }

    let previousElement = element.previousElementSibling;
    // First, lookup siblings before
    while (previousElement) {
      if (
        previousElement.tagName.toLowerCase() === "audio" ||
        previousElement.tagName.toLowerCase() === "video"
      ) {
        return previousElement;
      } else {
        const mediaChildren = previousElement.querySelector("audio, video");
        if (mediaChildren) {
          return mediaChildren[mediaChildren.length - 1];
        }
      }
      previousElement = previousElement.previousElementSibling;
    }

    if (element.parentElement) {
      return this.findMediaElementBefore(element.parentElement);
    } else {
      return null;
    }
  }

  /**
   * Parse lyrics syntax to HTML with data properties
   */
  parseLyrics() {
    // Do not do anything if no lyrics element was found
    if (!this.element) {
      return this;
    }

    let lines = this.element.textContent.trim().split("\n");
    
    let backupElement = document.createElement("p");
    backupElement.className = "rabbit-lyrics__backup";
    backupElement.setAttribute("hidden",true);
    backupElement.addEventListener('click', this.detachLyrics);
    backupElement.innerHTML = this.element.innerHTML;

    this.element.textContent = "";
    this.element.appendChild(backupElement);

    let lastTime = 0; // Remember last time stamp. If next lines doesn't
    // have beginning time stamp, use this value
    let lineElementsWithoutEndingTime = []; // Store elements without ending
    // time stamp and add later

    for (let i = 0; i < lines.length; i++) {
      // Make a new <div> element for the lyrics line
      let lineElement = document.createElement("div");
      lineElement.className = "rabbit-lyrics__line";
      this.element.appendChild(lineElement);
      this.lineElements.push(lineElement);

      let line = lines[i].trim();

      // Look up time stamps
      let timeStamps = line.match(/\[(\d+:)?\d+:\d+\.\d+\]/g) || [];
      let beginningTimeStamp = line.match(/^\[(\d+:)?\d+:\d+\.\d+\]/g) || [];
      let endingTimeStamp = line.match(/\[(\d+:)?\d+:\d+\.\d+\]$/g) || [];

      // If this line has any timestamps, previous lines without ending
      // time stamps could use its first time stamp as ending time stamp
      if (timeStamps.length && lineElementsWithoutEndingTime.length) {
        lineElementsWithoutEndingTime.forEach(function(element) {
          element.dataset.end = this.decodeTimeStamp(timeStamps[0]);
        }, this);
        lineElementsWithoutEndingTime = [];
      }

      // Set beginning time. If not available, use lastTime instead
      if (beginningTimeStamp.length > 0) {
        lineElement.dataset.start = this.decodeTimeStamp(beginningTimeStamp[0]);
        lastTime = this.decodeTimeStamp(beginningTimeStamp[0]);
      } else {
        lineElement.dataset.start = lastTime;
      }

      // Set ending time. If not available, use Infinity instead and stored
      // for changes in future
      if (endingTimeStamp.length > 0) {
        lineElement.dataset.end = this.decodeTimeStamp(endingTimeStamp[0]);
        lastTime = this.decodeTimeStamp(endingTimeStamp[0]);
      } else {
        lineElement.dataset.end = Infinity;
        lineElementsWithoutEndingTime.push(lineElement);
      }

      // Remove parsed time stamps and append to element
      line = line.replace(/\[(\d+:)?\d+:\d+\.\d+\]/g, "");

      // Use Non-Break Space for empty lines. Otherwise, the line hight of
      // will be 0
      if (!line) {
        line = "&nbsp;";
      }

      lineElement.innerHTML = line;
    }

    return this;
  }

  /**
   * Enable lyrics playback
   */
  enableLyrics() {
    // Do not do anything if no media element was found
    if (!this.mediaElement) {
      console.log('no media found');
      return this;
    }

    // Rest scroll bar
    this.element.scrollTop = 0;

    // Bind playback update events
    this.mediaElement.addEventListener('timeupdate', this.synchronize);

    this.mediaElement.addEventListener('play', this.setStatus);
    this.mediaElement.addEventListener('playing',  this.setStatus);
    this.mediaElement.addEventListener('pause',  this.setStatus);
    this.mediaElement.addEventListener('waiting',  this.setStatus);
    this.mediaElement.addEventListener('ended',  this.setStatus);

    // Add enabled status class. Avoid initializing the same element twice
    this.element.classList.add("rabbit-lyrics--enabled");

    return this;
  }
  
  /**
   * Detach and restore the lyric text
   */
  detachLyrics() {
    // Unind playback update events
    this.mediaElement.removeEventListener('timeupdate', this.synchronize);

    this.mediaElement.removeEventListener('play', this.setStatus);
    this.mediaElement.removeEventListener('playing',  this.setStatus);
    this.mediaElement.removeEventListener('pause',  this.setStatus);
    this.mediaElement.removeEventListener('waiting',  this.setStatus);
    this.mediaElement.removeEventListener('ended',  this.setStatus);
    
    // Remove classes.
    this.element.classList.remove("rabbit-lyrics--default", "rabbit-lyrics--mini", "rabbit-lyrics--full");
    this.element.classList.remove("rabbit-lyrics--playing", "rabbit-lyrics--paused", "rabbit-lyrics--waiting", "rabbit-lyrics--ended");
    this.element.classList.remove("rabbit-lyrics--scroll");
    this.element.classList.remove("rabbit-lyrics--enabled");
    this.element.classList.remove("rabbit-lyrics");
    
    // Restore lyric box.
    this.element.innerHTML=this.element.getElementsByTagName("p")[0].innerHTML;
    
    this.element.detachLyrics=null;
  }

  /**
   *
   * @param {Event} e Media element event
   */
  setStatus(e) {
    let status; // playing, paused, waiting, ended
    switch (e.type) {
      case 'play':
      case 'playing':
        status = 'playing';
        break;
      case 'pause':
        status = 'paused';
        break;
      case 'waiting':
        status = 'waiting';
        break;
      case 'ended':
        status = 'ended';
        break;
    }
    this.element.classList.remove("rabbit-lyrics--playing", "rabbit-lyrics--paused", "rabbit-lyrics--waiting", "rabbit-lyrics--ended");
    if (status) {
      this.element.classList.add("rabbit-lyrics--" + status);
    }
  }

  /**
   * Synchronize media element time and lyrics lines
   */
  synchronize() {
    let time = this.mediaElement.currentTime - this.element.dataset.delay;
    let changed = false; // If here are active lines changed
    let activeLineElements = [];

    this.lineElements.forEach(element => {
      if (time >= element.dataset.start && time <= element.dataset.end) {
        // If line should be active
        if (!element.classList.contains("rabbit-lyrics__line--active")) {
          // If it hasn't been activated
          changed = true;
          element.classList.add("rabbit-lyrics__line--active");
        }
        activeLineElements.push(element);
      } else {
        // If line should be inactive
        if (element.classList.contains("rabbit-lyrics__line--active")) {
          // If it hasn't been deactivated
          changed = true;
          element.classList.remove("rabbit-lyrics__line--active");
        }
      }
    });

    if (this.element.classList.contains("rabbit-lyrics--scroll") && changed && activeLineElements.length > 0) {
      // Calculate scroll top. Vertically align active lines in middle
      let activeLinesOffsetTop =
        (activeLineElements[0].offsetTop +
          activeLineElements[activeLineElements.length - 1].offsetTop +
          activeLineElements[activeLineElements.length - 1].offsetHeight) /
        2;
      this.scrollTop = activeLinesOffsetTop - this.element.clientHeight / 2;

      // Start scrolling animation
      clearInterval(this.scrollerInterval);
      this.scrollerTimer = this.scrollerIntervalDuration;
      this.scrollerInterval = setInterval(
        this.scroll,
        this.scrollerIntervalStep
      );
    }
  }

  /**
   * One step of scrolling animation
   */
  scroll() {
    // If it is already scrolled to position, stop animation interval
    if (this.scrollerTimer <= 0) {
      clearInterval(this.scrollerInterval);
      return;
    }

    let distance = this.scrollTop - this.element.scrollTop;
    let movement = (distance * this.scrollerIntervalStep) / this.scrollerTimer;

    this.element.scrollTop += movement;

    this.scrollerTimer -= this.scrollerIntervalStep;
  }

  /**
   * Convert time stamp to seconds
   * @param {string} timestamp Lyrics time stamp, in format [2:17.88] or [1:03:45.32]
   * @return {number} Time in seconds, float number
   */
  decodeTimeStamp(timestamp) {
    if (!timestamp || typeof timestamp !== "string") return 0;

    let results;

    // [hh:mm:ss.xx] format, used by some long audio books
    results = timestamp.match(/\[(\d+):(\d+):(\d+\.\d+)\]/);
    if (results && results.length === 4) {
      return (
        parseInt(results[1]) * 60 * 60 +
        parseInt(results[2]) * 60 +
        parseFloat(results[3])
      );
    }

    // [mm:ss.xx] format, widely used for songs
    results = timestamp.match(/\[(\d+):(\d+\.\d+)\]/);
    if (results && results.length === 3) {
      return parseInt(results[1]) * 60 + parseFloat(results[2]);
    }

    return 0;
  }
}

// Enable or disable auto scroll
export function setAutoScroll(element,scroll){
  if (scroll) {
    element.classList.add("rabbit-lyrics--scroll");
  } else {
    element.classList.remove("rabbit-lyrics--scroll");
  }
}

// Set delay time (in seconds)
export function setDelay(element,delay){
  element.dataset.delay=delay;
}

// Detach rabbit lyric
export function detachRabbitLyric(element){
  if(element!=undefined) {
    let interactiveElement=element.getElementsByTagName("p")[0];
      if(interactiveElement!=undefined) {
        interactiveElement.click();
      } else {
        element.classList.remove("rabbit-lyrics--enabled");
        // Just to ensure. Sometimes the internal element is deleted by mistake.
      }
  }
}

// Support HTML syntax (doesn't work in older IEs)
document.addEventListener(
  "DOMContentLoaded",
  function() {
    let elements = document.getElementsByClassName("rabbit-lyrics");

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      let mediaElement = document.querySelector(element.dataset.media);
      let { viewMode, height, alignment } = element.dataset;
      let options = {
        element,
        mediaElement,
        viewMode,
        height,
        alignment
      };

      new RabbitLyrics(options);
    }
  },
  false
);
