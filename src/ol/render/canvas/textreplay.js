goog.provide('ol.render.canvas.TextReplay');

goog.require('ol');
goog.require('ol.colorlike');
goog.require('ol.dom');
goog.require('ol.extent');
goog.require('ol.geom.flat.straightchunk');
goog.require('ol.geom.GeometryType');
goog.require('ol.has');
goog.require('ol.render.canvas');
goog.require('ol.render.canvas.Instruction');
goog.require('ol.render.canvas.Replay');
goog.require('ol.render.replay');
goog.require('ol.style.TextPlacement');


/**
 * @constructor
 * @extends {ol.render.canvas.Replay}
 * @param {number} tolerance Tolerance.
 * @param {ol.Extent} maxExtent Maximum extent.
 * @param {number} resolution Resolution.
 * @param {number} pixelRatio Pixel ratio.
 * @param {boolean} overlaps The replay can have overlapping geometries.
 * @param {?} declutterTree Declutter tree.
 * @struct
 */
ol.render.canvas.TextReplay = function(
    tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree) {
  ol.render.canvas.Replay.call(this,
      tolerance, maxExtent, resolution, pixelRatio, overlaps, declutterTree);

  /**
   * @private
   * @type {ol.DeclutterGroup}
   */
  this.declutterGroup_;

  /**
   * @private
   * @type {Array.<HTMLCanvasElement>}
   */
  this.labels_ = null;

  /**
   * @private
   * @type {string}
   */
  this.text_ = '';

  /**
   * @private
   * @type {number}
   */
  this.textOffsetX_ = 0;

  /**
   * @private
   * @type {number}
   */
  this.textOffsetY_ = 0;

  /**
   * @private
   * @type {boolean|undefined}
   */
  this.textRotateWithView_ = undefined;

  /**
   * @private
   * @type {number}
   */
  this.textRotation_ = 0;

  /**
   * @private
   * @type {?ol.CanvasFillState}
   */
  this.textFillState_ = null;

  /**
   * @private
   * @type {?ol.CanvasStrokeState}
   */
  this.textStrokeState_ = null;

  /**
   * @private
   * @type {ol.CanvasTextState}
   */
  this.textState_ = /** @type {ol.CanvasTextState} */ ({});

  /**
   * @private
   * @type {string}
   */
  this.textKey_ = '';

  /**
   * @private
   * @type {string}
   */
  this.fillKey_ = '';

  /**
   * @private
   * @type {string}
   */
  this.strokeKey_ = '';

  /**
   * @private
   * @type {Object.<string, number>}
   */
  this.widths_ = {};

};
ol.inherits(ol.render.canvas.TextReplay, ol.render.canvas.Replay);


/**
 * @param {string} font Font to use for measuring.
 * @return {ol.Size} Measurement.
 */
ol.render.canvas.TextReplay.measureTextHeight = (function() {
  var span;
  var heights = {};
  return function(font) {
    var height = heights[font];
    if (height == undefined) {
      if (!span) {
        span = document.createElement('span');
        span.textContent = 'M';
        span.style.margin = span.style.padding = '0 !important';
        span.style.position = 'absolute !important';
        span.style.left = '-99999px !important';
      }
      span.style.font = font;
      document.body.appendChild(span);
      height = heights[font] = span.offsetHeight;
      document.body.removeChild(span);
    }
    return height;
  };
})();


/**
 * @param {string} font Font.
 * @param {string} text Text.
 * @return {number} Width.
 */
ol.render.canvas.TextReplay.measureTextWidth = (function() {
  var measureContext;
  var currentFont;
  return function(font, text) {
    if (!measureContext) {
      measureContext = ol.dom.createCanvasContext2D(1, 1);
    }
    if (font != currentFont) {
      currentFont = measureContext.font = font;
    }
    return measureContext.measureText(text).width;
  };
})();


/**
 * @param {string} font Font to use for measuring.
 * @param {Array.<string>} lines Lines to measure.
 * @param {Array.<number>} widths Array will be populated with the widths of
 * each line.
 * @return {number} Width of the whole text.
 */
ol.render.canvas.TextReplay.measureTextWidths = function(font, lines, widths) {
  var numLines = lines.length;
  var width = 0;
  var currentWidth, i;
  for (i = 0; i < numLines; ++i) {
    currentWidth = ol.render.canvas.TextReplay.measureTextWidth(font, lines[i]);
    width = Math.max(width, currentWidth);
    widths.push(currentWidth);
  }
  return width;
};


/**
 * @inheritDoc
 */
ol.render.canvas.TextReplay.prototype.drawText = function(geometry, feature) {
  var fillState = this.textFillState_;
  var strokeState = this.textStrokeState_;
  var textState = this.textState_;
  if (this.text_ === '' || !textState || (!fillState && !strokeState)) {
    return;
  }

  var begin = this.coordinates.length;

  var geometryType = geometry.getType();
  var flatCoordinates = null;
  var end = 2;
  var stride = 2;
  var i, ii;

  if (textState.placement === ol.style.TextPlacement.LINE) {
    if (!ol.extent.intersects(this.getBufferedMaxExtent(), geometry.getExtent())) {
      return;
    }
    var ends;
    flatCoordinates = geometry.getFlatCoordinates();
    stride = geometry.getStride();
    if (geometryType == ol.geom.GeometryType.LINE_STRING) {
      ends = [flatCoordinates.length];
    } else if (geometryType == ol.geom.GeometryType.MULTI_LINE_STRING) {
      ends = geometry.getEnds();
    } else if (geometryType == ol.geom.GeometryType.POLYGON) {
      ends = geometry.getEnds().slice(0, 1);
    } else if (geometryType == ol.geom.GeometryType.MULTI_POLYGON) {
      var endss = geometry.getEndss();
      ends = [];
      for (i = 0, ii = endss.length; i < ii; ++i) {
        ends.push(endss[i][0]);
      }
    }
    this.beginGeometry(geometry, feature);
    var textAlign = textState.textAlign;
    var flatOffset = 0;
    var flatEnd;
    for (var o = 0, oo = ends.length; o < oo; ++o) {
      if (textAlign == undefined) {
        var range = ol.geom.flat.straightchunk.lineString(
            textState.maxAngle, flatCoordinates, flatOffset, ends[o], stride);
        flatOffset = range[0];
        flatEnd = range[1];
      } else {
        flatEnd = ends[o];
      }
      for (i = flatOffset; i < flatEnd; i += stride) {
        this.coordinates.push(flatCoordinates[i], flatCoordinates[i + 1]);
      }
      end = this.coordinates.length;
      flatOffset = ends[o];
      this.drawChars_(begin, end, this.declutterGroup_);
      begin = end;
    }
    this.endGeometry(geometry, feature);

  } else {
    var label = this.getImage(this.text_, !!this.textFillState_, !!this.textStrokeState_);
    var width = label.width / this.pixelRatio;
    switch (geometryType) {
      case ol.geom.GeometryType.POINT:
      case ol.geom.GeometryType.MULTI_POINT:
        flatCoordinates = geometry.getFlatCoordinates();
        end = flatCoordinates.length;
        break;
      case ol.geom.GeometryType.LINE_STRING:
        flatCoordinates = /** @type {ol.geom.LineString} */ (geometry).getFlatMidpoint();
        break;
      case ol.geom.GeometryType.CIRCLE:
        flatCoordinates = /** @type {ol.geom.Circle} */ (geometry).getCenter();
        break;
      case ol.geom.GeometryType.MULTI_LINE_STRING:
        flatCoordinates = /** @type {ol.geom.MultiLineString} */ (geometry).getFlatMidpoints();
        end = flatCoordinates.length;
        break;
      case ol.geom.GeometryType.POLYGON:
        flatCoordinates = /** @type {ol.geom.Polygon} */ (geometry).getFlatInteriorPoint();
        if (!textState.exceedLength && flatCoordinates[2] / this.resolution < width) {
          return;
        }
        stride = 3;
        break;
      case ol.geom.GeometryType.MULTI_POLYGON:
        var interiorPoints = /** @type {ol.geom.MultiPolygon} */ (geometry).getFlatInteriorPoints();
        flatCoordinates = [];
        for (i = 0, ii = interiorPoints.length; i < ii; i += 3) {
          if (textState.exceedLength || interiorPoints[i + 2] / this.resolution >= width) {
            flatCoordinates.push(interiorPoints[i], interiorPoints[i + 1]);
          }
        }
        end = flatCoordinates.length;
        if (end == 0) {
          return;
        }
        break;
      default:
    }
    end = this.appendFlatCoordinates(flatCoordinates, 0, end, stride, false, false);
    this.beginGeometry(geometry, feature);
    this.drawTextImage_(label, begin, end);
    this.endGeometry(geometry, feature);
  }
};


/**
 * @param {string} text Text.
 * @param {boolean} fill Fill.
 * @param {boolean} stroke Stroke.
 * @return {HTMLCanvasElement} Image.
 */
ol.render.canvas.TextReplay.prototype.getImage = function(text, fill, stroke) {
  var label;
  var key = (stroke ? this.strokeKey_ : '') + this.textKey_ + text + (fill ? this.fillKey_ : '');

  var labelCache = ol.render.canvas.labelCache;
  if (!labelCache.containsKey(key)) {
    var strokeState = this.textStrokeState_;
    var fillState = this.textFillState_;
    var textState = this.textState_;
    var pixelRatio = this.pixelRatio;
    var scale = textState.scale * pixelRatio;
    var align =  ol.render.replay.TEXT_ALIGN[textState.textAlign || ol.render.canvas.defaultTextAlign];
    var strokeWidth = stroke && strokeState.lineWidth ? strokeState.lineWidth : 0;

    var lines = text.split('\n');
    var numLines = lines.length;
    var widths = [];
    var width = ol.render.canvas.TextReplay.measureTextWidths(textState.font, lines, widths);
    var lineHeight = ol.render.canvas.TextReplay.measureTextHeight(textState.font);
    var height = lineHeight * numLines;
    var renderWidth = (width + strokeWidth);
    var context = ol.dom.createCanvasContext2D(
        Math.ceil(renderWidth * scale),
        Math.ceil((height + strokeWidth) * scale));
    label = context.canvas;
    labelCache.pruneAndSet(key, label);
    if (scale != 1) {
      context.scale(scale, scale);
    }
    context.font = textState.font;
    if (stroke) {
      context.strokeStyle = strokeState.strokeStyle;
      context.lineWidth = strokeWidth * (ol.has.SAFARI ? scale : 1);
      context.lineCap = strokeState.lineCap;
      context.lineJoin = strokeState.lineJoin;
      context.miterLimit = strokeState.miterLimit;
      if (ol.has.CANVAS_LINE_DASH && strokeState.lineDash.length) {
        context.setLineDash(strokeState.lineDash);
        context.lineDashOffset = strokeState.lineDashOffset;
      }
    }
    if (fill) {
      context.fillStyle = fillState.fillStyle;
    }
    context.textBaseline = 'top';
    context.textAlign = 'center';
    var leftRight = (0.5 - align);
    var x = align * label.width / scale + leftRight * strokeWidth;
    var i;
    if (stroke) {
      for (i = 0; i < numLines; ++i) {
        context.strokeText(lines[i], x + leftRight * widths[i], 0.5 * strokeWidth + i * lineHeight);
      }
    }
    if (fill) {
      for (i = 0; i < numLines; ++i) {
        context.fillText(lines[i], x + leftRight * widths[i], 0.5 * strokeWidth + i * lineHeight);
      }
    }
  }
  return labelCache.get(key);
};


/**
 * @private
 * @param {HTMLCanvasElement} label Label.
 * @param {number} begin Begin.
 * @param {number} end End.
 */
ol.render.canvas.TextReplay.prototype.drawTextImage_ = function(label, begin, end) {
  var textState = this.textState_;
  var strokeState = this.textStrokeState_;
  var pixelRatio = this.pixelRatio;
  var align = ol.render.replay.TEXT_ALIGN[textState.textAlign || ol.render.canvas.defaultTextAlign];
  var baseline = ol.render.replay.TEXT_ALIGN[textState.textBaseline];
  var strokeWidth = strokeState && strokeState.lineWidth ? strokeState.lineWidth : 0;

  var anchorX = align * label.width / pixelRatio + 2 * (0.5 - align) * strokeWidth;
  var anchorY = baseline * label.height / pixelRatio + 2 * (0.5 - baseline) * strokeWidth;
  this.instructions.push([ol.render.canvas.Instruction.DRAW_IMAGE, begin, end,
    label, (anchorX - this.textOffsetX_) * pixelRatio, (anchorY - this.textOffsetY_) * pixelRatio,
    this.declutterGroup_, label.height, 1, 0, 0, this.textRotateWithView_, this.textRotation_,
    1, true, label.width
  ]);
  this.hitDetectionInstructions.push([ol.render.canvas.Instruction.DRAW_IMAGE, begin, end,
    label, (anchorX - this.textOffsetX_) * pixelRatio, (anchorY - this.textOffsetY_) * pixelRatio,
    this.declutterGroup_, label.height, 1, 0, 0, this.textRotateWithView_, this.textRotation_,
    1 / pixelRatio, true, label.width
  ]);
};


/**
 * @private
 * @param {number} begin Begin.
 * @param {number} end End.
 * @param {ol.DeclutterGroup} declutterGroup Declutter group.
 */
ol.render.canvas.TextReplay.prototype.drawChars_ = function(begin, end, declutterGroup) {
  var pixelRatio = this.pixelRatio;
  var strokeState = this.textStrokeState_;
  var fill = !!this.textFillState_;
  var stroke = !!strokeState;
  var textState = this.textState_;
  var baseline = ol.render.replay.TEXT_ALIGN[textState.textBaseline];

  var offsetY = this.textOffsetY_ * pixelRatio;
  var textAlign = ol.render.replay.TEXT_ALIGN[textState.textAlign || ol.render.canvas.defaultTextAlign];
  var text = this.text_;
  var font = textState.font;
  var textScale = textState.scale;
  var strokeWidth = strokeState ? strokeState.lineWidth * textScale / 2 : 0;
  var widths = this.widths_;
  this.instructions.push([ol.render.canvas.Instruction.DRAW_CHARS,
    begin, end, baseline, declutterGroup,
    textState.exceedLength, fill, textState.maxAngle,
    function(text) {
      var width = widths[text];
      if (!width) {
        width = widths[text] = ol.render.canvas.TextReplay.measureTextWidth(font, text);
      }
      return width * textScale * pixelRatio;
    },
    offsetY, stroke, strokeWidth * pixelRatio, text, textAlign, 1
  ]);
  this.hitDetectionInstructions.push([ol.render.canvas.Instruction.DRAW_CHARS,
    begin, end, baseline, declutterGroup,
    textState.exceedLength, fill, textState.maxAngle,
    function(text) {
      var width = widths[text];
      if (!width) {
        width = widths[text] = ol.render.canvas.TextReplay.measureTextWidth(font, text);
      }
      return width * textScale;
    },
    offsetY, stroke, strokeWidth, text, textAlign, 1 / pixelRatio
  ]);
};


/**
 * @inheritDoc
 */
ol.render.canvas.TextReplay.prototype.setTextStyle = function(textStyle, declutterGroup) {
  var textState, fillState, strokeState;
  if (!textStyle) {
    this.text_ = '';
  } else {
    this.declutterGroup_ = /** @type {ol.DeclutterGroup} */ (declutterGroup);

    var textFillStyle = textStyle.getFill();
    if (!textFillStyle) {
      fillState = this.textFillState_ = null;
    } else {
      fillState = this.textFillState_;
      if (!fillState) {
        fillState = this.textFillState_ = /** @type {ol.CanvasFillState} */ ({});
      }
      fillState.fillStyle = ol.colorlike.asColorLike(
          textFillStyle.getColor() || ol.render.canvas.defaultFillStyle);
    }

    var textStrokeStyle = textStyle.getStroke();
    if (!textStrokeStyle) {
      strokeState = this.textStrokeState_ = null;
    } else {
      strokeState = this.textStrokeState_;
      if (!strokeState) {
        strokeState = this.textStrokeState_ = /** @type {ol.CanvasStrokeState} */ ({});
      }
      var lineDash = textStrokeStyle.getLineDash();
      var lineDashOffset = textStrokeStyle.getLineDashOffset();
      var lineWidth = textStrokeStyle.getWidth();
      var miterLimit = textStrokeStyle.getMiterLimit();
      strokeState.lineCap = textStrokeStyle.getLineCap() || ol.render.canvas.defaultLineCap;
      strokeState.lineDash = lineDash ? lineDash.slice() : ol.render.canvas.defaultLineDash;
      strokeState.lineDashOffset =
          lineDashOffset === undefined ? ol.render.canvas.defaultLineDashOffset : lineDashOffset;
      strokeState.lineJoin = textStrokeStyle.getLineJoin() || ol.render.canvas.defaultLineJoin;
      strokeState.lineWidth =
          lineWidth === undefined ? ol.render.canvas.defaultLineWidth : lineWidth;
      strokeState.miterLimit =
          miterLimit === undefined ? ol.render.canvas.defaultMiterLimit : miterLimit;
      strokeState.strokeStyle = ol.colorlike.asColorLike(
          textStrokeStyle.getColor() || ol.render.canvas.defaultStrokeStyle);
    }

    textState = this.textState_;
    var font = textStyle.getFont() || ol.render.canvas.defaultFont;
    ol.render.canvas.checkFont(font);
    var textScale = textStyle.getScale();
    textState.exceedLength = textStyle.getExceedLength();
    textState.font = font;
    textState.maxAngle = textStyle.getMaxAngle();
    textState.placement = textStyle.getPlacement();
    textState.textAlign = textStyle.getTextAlign();
    textState.textBaseline = textStyle.getTextBaseline() || ol.render.canvas.defaultTextBaseline;
    textState.scale = textScale === undefined ? 1 : textScale;

    var textOffsetX = textStyle.getOffsetX();
    var textOffsetY = textStyle.getOffsetY();
    var textRotateWithView = textStyle.getRotateWithView();
    var textRotation = textStyle.getRotation();
    this.text_ = textStyle.getText() || '';
    this.textOffsetX_ = textOffsetX === undefined ? 0 : textOffsetX;
    this.textOffsetY_ = textOffsetY === undefined ? 0 : textOffsetY;
    this.textRotateWithView_ = textRotateWithView === undefined ? false : textRotateWithView;
    this.textRotation_ = textRotation === undefined ? 0 : textRotation;

    this.strokeKey_ = strokeState ?
      (typeof strokeState.strokeStyle == 'string' ? strokeState.strokeStyle : ol.getUid(strokeState.strokeStyle)) +
      strokeState.lineCap + strokeState.lineDashOffset + '|' + strokeState.lineWidth +
      strokeState.lineJoin + strokeState.miterLimit + '[' + strokeState.lineDash.join() + ']' :
      '';
    this.textKey_ = textState.font + (textState.textAlign || '?') + textState.scale;
    this.fillKey_ = fillState ?
      (typeof fillState.fillStyle == 'string' ? fillState.fillStyle : ('|' + ol.getUid(fillState.fillStyle))) :
      '';
  }
};
