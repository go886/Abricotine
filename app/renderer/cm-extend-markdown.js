/*
*   Abricotine - Markdown Editor
*   Copyright (c) 2015 Thomas Brouard
*   Licensed under GNU-GPLv3 <http://www.gnu.org/licenses/gpl.html>
*/

/* jshint esversion: 6 */
// TODO: support multiple selections

const styles = require.main.require("./cm-markdown-styles.js");

module.exports = function (CodeMirror) {
  CodeMirror.prototype.format = function (name) {
    const getState = (pos = this.getCursor("start")) => {
      const type = this.getTokenTypeAt(pos);
      if (!type) return [];
      const classnames = type.split(" ");
      return classnames;
    };

    const getClassname = (style, getDelimiter = false) => {
      const hint = getDelimiter ? (style.delimiterClassname || style.classname) : style.classname;
      if (typeof hint === "function") {
        return hint(this, style);
      }
      return hint;
    };

    const isApplied = (classnames, style) => {
      const isMatch = (name) => classnames.indexOf(name) > -1;
      const classname = getClassname(style);
      const delimiterClassname = `formatting-${getClassname(style, true)}`;
      return isMatch(classname) || isMatch(delimiterClassname);
    };

    const removeInlineStyle = (style) => {
      if (!style.reversible || style.delimiter == null) return;

      // Fix selection if it contains formatting characters
      const fixSelection = () => {
        const delimiter = style.delimiter;
        const length = delimiter.length;
        const text = this.getSelection("\n");
        if (text.length < length);
        const cursorFrom = this.getCursor("from");
        const cursorTo = this.getCursor("to");
        if (text.slice(0, length) === delimiter) {
          cursorFrom.ch += length;
        }
        if (text.slice(0 - length) === delimiter) {
          cursorTo.ch -= length;
        }
      };

      const getDelimiter = (pos, classname, step) => {
        const getNextMove = (pos, step) => {
          const lineLength = this.getLine(pos.line).length;
          const chStep = pos.ch + step;
          const isOutOfLine = chStep < 0 || chStep > lineLength;
          if (isOutOfLine) {
            const firstLine = this.firstLine();
            const lastLine = this.lastLine();
            const lineStep = pos.line + step;
            const isOutOfEditor = lineStep < firstLine || lineStep > lastLine;
            if (isOutOfEditor) return null;
            return {
              line: lineStep,
              ch: step > 0 ? 0 : this.getLine(lineStep).length
            };
          }
          return {
            line: pos.line,
            ch: chStep
          };
        };

        let move = {
          line: pos.line,
          ch: step > 0 ? pos.ch + 1 : pos.ch
        };
        while (move) {
          const type = this.getTokenTypeAt(move) || "";
          if (type.split(" ").includes(`formatting-${classname}`)) {
            move.ch--;
            return move;
          }
          move = getNextMove(move, step);
        }
      };

      fixSelection();

      const cursorFrom = this.getCursor("from");
      const cursorTo = this.getCursor("to");
      const delimiterClassname = getClassname(style, true);
      const prevDelimiter = getDelimiter(cursorFrom, delimiterClassname, -1);
      const nextDelimiter = getDelimiter(cursorTo, delimiterClassname, 1);
      if (!prevDelimiter || !nextDelimiter) return;

      // Get text
      const delimiterLength = style.delimiter.length;
      const insideFrom = Object.assign({}, prevDelimiter);
      const insideTo = Object.assign({}, nextDelimiter);
      insideFrom.ch++;
      const text = this.getRange(insideFrom, insideTo);

      // Replace text (without delimiters)
      const outsideFrom = Object.assign({}, insideFrom);
      const outsideTo = Object.assign({}, insideTo);
      outsideFrom.ch -= delimiterLength;
      outsideTo.ch += delimiterLength;
      this.replaceRange(text, outsideFrom, outsideTo);

      // Select new text
      const selFrom = Object.assign({}, outsideFrom);
      const selTo = Object.assign({}, insideTo);
      if (selFrom.line === selTo.line) {
        selTo.ch -= delimiterLength;
      }
      this.setSelection(selFrom, selTo);
    };

    const countNewLines = (str) => {
      const match = str.match(/\n/g);
      const newLines = match ? match.length : 0;
      return newLines;
    };

    const getLastLineLength = (start, str) => {
      const newLinePos = str.lastIndexOf("\n");
      if (newLinePos === -1) return start.ch + str.length;
      return str.length - str.lastIndexOf("\n") - 1;
    };

    const addInlineStyle = (style) => {
      const getSetFunc = (style) => {
        if (style.set === "wrap") {
          return ({text, anchor, head, delimiter}) => [delimiter, anchor, text, head, delimiter];
        }
        if (typeof style.set !== "function") {
          throw Error("style.set is not a function");
        }
        return style.set;
      };

      const getTrimmedText = () => {
        const getMatchesNb = (text, regex) => {
          return (text.match(regex) || [""])[0].length;
        };
        const text = this.getSelection();
        const nbSpacesBefore = getMatchesNb(text, /^\s+/);
        const nbSpacesAfter = getMatchesNb(text, /\s+$/);
        if (nbSpacesBefore === 0 && nbSpacesAfter === 0) return text;
        const start = this.getCursor("from");
        const end = this.getCursor("to");
        start.ch += nbSpacesBefore;
        end.ch -= nbSpacesAfter;
        this.setSelection(start, end);
        return this.getRange(start, end);
      };

      const setFunc = getSetFunc(style);
      const text = getTrimmedText();
      const anchor = Symbol("anchor");
      const head = Symbol("head");
      const delimiter = style.delimiter;
      const template = setFunc({text, anchor, head, delimiter}, this);
      const selection = {};

      const getCurrentPosition = (sum) => {
        const newLines = countNewLines(sum);
        // TODO: get those values once and for all
        const start = this.getCursor("start");
        const lastLineLength = getLastLineLength(start, sum);
        return {
          line: start.line + newLines,
          ch: lastLineLength
        };
      };

      const newText = template.reduce((sum, el) => {
        if (typeof el === "string") {
          return sum + el;
        }
        if (el === anchor) {
          selection.anchor = getCurrentPosition(sum);
        } else if (el === head) {
          selection.head = getCurrentPosition(sum);
        }
        return sum;
      }, "");

      // FIXME: duplicate actions
      const start = this.getCursor("from");
      const end = this.getCursor("to");
      this.replaceRange(newText, start, end, "+addInlineStyle");
      this.setSelection(selection.anchor, selection.head);
    };

    const toggleInline = (style) => {
      const classnames = getState();
      const styleIsApplied = isApplied(classnames, style);
      if (styleIsApplied) {
        removeInlineStyle(style);
      } else {
        addInlineStyle(style);
      }
    };

    const toggleBlock = (style) => {
      const setLine = (line, text) => {
        const start = {line, ch: 0};
        const end = {line};
        this.replaceRange(text, start, end, "+setLine");
      };

      const start = this.getCursor("start");
      const end = this.getCursor("end");
      // FIXME: use a consistent varname for "state" everywhere
      const state = getState();
      const classname = getClassname(style);
      const alreadyHasThisType = state.includes(classname);

      const clearTypes = (state, text) => {
        Object.keys(styles).forEach((key) => {
          const style = styles[key];
          if (style.type !== "block") return;
          const styleIsApplied = isApplied(state, style);
          if (styleIsApplied) {
            text = text.replace(style.regex, "$1");
          }
        });
        return text;
      };

      const doc = this.doc;
      let count = 0;
      doc.eachLine(start.line, end.line + 1, (line) => {
        const lineNumber = doc.getLineNumber(line);
        let text = line.text;
        text = clearTypes(state, text);
        if (!alreadyHasThisType) {
          text = style.prepend + text;
          if (style.prependDigit) {
            count++;
            text = count + text;
          }
        }
        setLine(lineNumber, text);
      });

      // Update selection
      if (start.line !== end.line || start.ch !== end.ch) {
        this.setSelection({ch: 0, line: start.line}, {line: end.line});
      }
    };

    const style = styles[name];
    if (style == null) {
      throw Error(`Can't find style '${name}'`);
    }
    const fn = style.type === "inline" ? toggleInline : toggleBlock;
    return fn(style);
  };
};
