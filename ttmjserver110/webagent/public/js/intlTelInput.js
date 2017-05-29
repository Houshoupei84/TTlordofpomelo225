/*
International Telephone Input v6.0.6
https://github.com/Bluefieldscom/intl-tel-input.git
*/
// wrap in UMD - see https://github.com/umdjs/umd/blob/master/jqueryPlugin.js
(function(factory) {
    if (typeof define === "function" && define.amd) {
        define([ "jquery" ], function($) {
            factory($, window, document);
        });
    } else {
        factory(jQuery, window, document);
    }
})(function($, window, document, undefined) {
    "use strict";
    // these vars persist through all instances of the plugin
    var pluginName = "intlTelInput", id = 1, // give each instance it's own id for namespaced event handling
    defaults = {
        // typing digits after a valid number will be added to the extension part of the number
        allowExtensions: false,
        // automatically format the number according to the selected country
        autoFormat: true,
        // if there is just a dial code in the input: remove it on blur, and re-add it on focus
        autoHideDialCode: true,
        // add or remove input placeholder with an example number for the selected country
        autoPlaceholder: true,
        // default country
        defaultCountry: "",
        // geoIp lookup function
        geoIpLookup: null,
        // don't insert international dial codes
        nationalMode: true,
        // number type to use for placeholders
        numberType: "MOBILE",
        // display only these countries
        onlyCountries: [],
        // the countries at the top of the list. defaults to united states and united kingdom
        preferredCountries: [ "us", "gb" ],
        // specify the path to the libphonenumber script to enable validation/formatting
        utilsScript: ""
    }, keys = {
        UP: 38,
        DOWN: 40,
        ENTER: 13,
        ESC: 27,
        PLUS: 43,
        A: 65,
        Z: 90,
        ZERO: 48,
        NINE: 57,
        SPACE: 32,
        BSPACE: 8,
        TAB: 9,
        DEL: 46,
        CTRL: 17,
        CMD1: 91,
        // Chrome
        CMD2: 224
    }, windowLoaded = false;
    // keep track of if the window.load event has fired as impossible to check after the fact
    $(window).load(function() {
        windowLoaded = true;
    });
    function Plugin(element, options) {
        this.element = element;
        this.options = $.extend({}, defaults, options);
        this._defaults = defaults;
        // event namespace
        this.ns = "." + pluginName + id++;
        // Chrome, FF, Safari, IE9+
        this.isGoodBrowser = Boolean(element.setSelectionRange);
        this.hadInitialPlaceholder = Boolean($(element).attr("placeholder"));
        this._name = pluginName;
    }
    Plugin.prototype = {
        _init: function() {
            // if in nationalMode, disable options relating to dial codes
            if (this.options.nationalMode) {
                this.options.autoHideDialCode = false;
            }
            // IE Mobile doesn't support the keypress event (see issue 68) which makes autoFormat impossible
            if (navigator.userAgent.match(/IEMobile/i)) {
                this.options.autoFormat = false;
            }
            // we cannot just test screen size as some smartphones/website meta tags will report desktop resolutions
            // Note: for some reason jasmine fucks up if you put this in the main Plugin function with the rest of these declarations
            // Note: to target Android Mobiles (and not Tablets), we must find "Android" and "Mobile"
            this.isMobile = /Android.+Mobile|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            // we return these deferred objects from the _init() call so they can be watched, and then we resolve them when each specific request returns
            // Note: again, jasmine had a spazz when I put these in the Plugin function
            this.autoCountryDeferred = new $.Deferred();
            this.utilsScriptDeferred = new $.Deferred();
            // process all the data: onlyCountries, preferredCountries etc
            this._processCountryData();
            // generate the markup
            this._generateMarkup();
            // set the initial state of the input value and the selected flag
            this._setInitialState();
            // start all of the event listeners: autoHideDialCode, input keydown, selectedFlag click
            this._initListeners();
            // utils script, and auto country
            this._initRequests();
            // return the deferreds
            return [ this.autoCountryDeferred, this.utilsScriptDeferred ];
        },
        /********************
   *  PRIVATE METHODS
   ********************/
        // prepare all of the country data, including onlyCountries and preferredCountries options
        _processCountryData: function() {
            // set the instances country data objects
            this._setInstanceCountryData();
            // set the preferredCountries property
            this._setPreferredCountries();
        },
        // add a country code to this.countryCodes
        _addCountryCode: function(iso2, dialCode, priority) {
            if (!(dialCode in this.countryCodes)) {
                this.countryCodes[dialCode] = [];
            }
            var index = priority || 0;
            this.countryCodes[dialCode][index] = iso2;
        },
        // process onlyCountries array if present, and generate the countryCodes map
        _setInstanceCountryData: function() {
            var i;
            // process onlyCountries option
            if (this.options.onlyCountries.length) {
                // standardise case
                for (i = 0; i < this.options.onlyCountries.length; i++) {
                    this.options.onlyCountries[i] = this.options.onlyCountries[i].toLowerCase();
                }
                // build instance country array
                this.countries = [];
                for (i = 0; i < allCountries.length; i++) {
                    if ($.inArray(allCountries[i].iso2, this.options.onlyCountries) != -1) {
                        this.countries.push(allCountries[i]);
                    }
                }
            } else {
                this.countries = allCountries;
            }
            // generate countryCodes map
            this.countryCodes = {};
            for (i = 0; i < this.countries.length; i++) {
                var c = this.countries[i];
                this._addCountryCode(c.iso2, c.dialCode, c.priority);
                // area codes
                if (c.areaCodes) {
                    for (var j = 0; j < c.areaCodes.length; j++) {
                        // full dial code is country code + dial code
                        this._addCountryCode(c.iso2, c.dialCode + c.areaCodes[j]);
                    }
                }
            }
        },
        // process preferred countries - iterate through the preferences,
        // fetching the country data for each one
        _setPreferredCountries: function() {
            this.preferredCountries = [];
            for (var i = 0; i < this.options.preferredCountries.length; i++) {
                var countryCode = this.options.preferredCountries[i].toLowerCase(), countryData = this._getCountryData(countryCode, false, true);
                if (countryData) {
                    this.preferredCountries.push(countryData);
                }
            }
        },
        // generate all of the markup for the plugin: the selected flag overlay, and the dropdown
        _generateMarkup: function() {
            // telephone input
            this.telInput = $(this.element);
            // prevent autocomplete as there's no safe, cross-browser event we can react to, so it can easily put the plugin in an inconsistent state e.g. the wrong flag selected for the autocompleted number, which on submit could mean the wrong number is saved (esp in nationalMode)
            this.telInput.attr("autocomplete", "off");
            // containers (mostly for positioning)
            this.telInput.wrap($("<div>", {
                "class": "intl-tel-input"
            }));
            this.flagsContainer = $("<div>", {
                "class": "flag-dropdown"
            }).insertBefore(this.telInput);
            // currently selected flag (displayed to left of input)
            var selectedFlag = $("<div>", {
                // make element focusable and tab naviagable
                tabindex: "0",
                "class": "selected-flag"
            }).appendTo(this.flagsContainer);
            this.selectedFlagInner = $("<div>", {
                "class": "iti-flag"
            }).appendTo(selectedFlag);
            // CSS triangle
            $("<div>", {
                "class": "arrow"
            }).appendTo(selectedFlag);
            // country list
            // mobile is just a native select element
            // desktop is a proper list containing: preferred countries, then divider, then all countries
            if (this.isMobile) {
                this.countryList = $("<select>", {
                    "class": "iti-mobile-select"
                }).appendTo(this.flagsContainer);
            } else {
                this.countryList = $("<ul>", {
                    "class": "country-list v-hide"
                }).appendTo(this.flagsContainer);
                if (this.preferredCountries.length && !this.isMobile) {
                    this._appendListItems(this.preferredCountries, "preferred");
                    $("<li>", {
                        "class": "divider"
                    }).appendTo(this.countryList);
                }
            }
            this._appendListItems(this.countries, "");
            if (!this.isMobile) {
                // now we can grab the dropdown height, and hide it properly
                this.dropdownHeight = this.countryList.outerHeight();
                this.countryList.removeClass("v-hide").addClass("hide");
                // this is useful in lots of places
                this.countryListItems = this.countryList.children(".country");
            }
        },
        // add a country <li> to the countryList <ul> container
        // UPDATE: if isMobile, add an <option> to the countryList <select> container
        _appendListItems: function(countries, className) {
            // we create so many DOM elements, it is faster to build a temp string
            // and then add everything to the DOM in one go at the end
            var tmp = "";
            // for each country
            for (var i = 0; i < countries.length; i++) {
                var c = countries[i];
                if (this.isMobile) {
                    tmp += "<option data-dial-code='" + c.dialCode + "' value='" + c.iso2 + "'>";
                    tmp += c.name + " +" + c.dialCode;
                    tmp += "</option>";
                } else {
                    // open the list item
                    tmp += "<li class='country " + className + "' data-dial-code='" + c.dialCode + "' data-country-code='" + c.iso2 + "'>";
                    // add the flag
                    tmp += "<div class='flag'><div class='iti-flag " + c.iso2 + "'></div></div>";
                    // and the country name and dial code
                    tmp += "<span class='country-name'>" + c.name + "</span>";
                    tmp += "<span class='dial-code'>+" + c.dialCode + "</span>";
                    // close the list item
                    tmp += "</li>";
                }
            }
            this.countryList.append(tmp);
        },
        // set the initial state of the input value and the selected flag
        _setInitialState: function() {
            var val = this.telInput.val();
            // if there is a number, and it's valid, we can go ahead and set the flag, else fall back to default
            if (this._getDialCode(val)) {
                this._updateFlagFromNumber(val, true);
            } else if (this.options.defaultCountry != "auto") {
                // check the defaultCountry option, else fall back to the first in the list
                if (this.options.defaultCountry) {
                    this.options.defaultCountry = this._getCountryData(this.options.defaultCountry.toLowerCase(), false, false);
                } else {
                    this.options.defaultCountry = this.preferredCountries.length ? this.preferredCountries[0] : this.countries[0];
                }
                this._selectFlag(this.options.defaultCountry.iso2);
                // if empty, insert the default dial code (this function will check !nationalMode and !autoHideDialCode)
                if (!val) {
                    this._updateDialCode(this.options.defaultCountry.dialCode, false);
                }
            }
            // format
            if (val) {
                // this wont be run after _updateDialCode as that's only called if no val
                this._updateVal(val);
            }
        },
        // initialise the main event listeners: input keyup, and click selected flag
        _initListeners: function() {
            var that = this;
            this._initKeyListeners();
            // autoFormat prevents the change event from firing, so we need to check for changes between focus and blur in order to manually trigger it
            if (this.options.autoHideDialCode || this.options.autoFormat) {
                this._initFocusListeners();
            }
            if (this.isMobile) {
                this.countryList.on("change" + this.ns, function(e) {
                    that._selectListItem($(this).find("option:selected"));
                });
            } else {
                // hack for input nested inside label: clicking the selected-flag to open the dropdown would then automatically trigger a 2nd click on the input which would close it again
                var label = this.telInput.closest("label");
                if (label.length) {
                    label.on("click" + this.ns, function(e) {
                        // if the dropdown is closed, then focus the input, else ignore the click
                        if (that.countryList.hasClass("hide")) {
                            that.telInput.focus();
                        } else {
                            e.preventDefault();
                        }
                    });
                }
                // toggle country dropdown on click
                var selectedFlag = this.selectedFlagInner.parent();
                selectedFlag.on("click" + this.ns, function(e) {
                    // only intercept this event if we're opening the dropdown
                    // else let it bubble up to the top ("click-off-to-close" listener)
                    // we cannot just stopPropagation as it may be needed to close another instance
                    if (that.countryList.hasClass("hide") && !that.telInput.prop("disabled") && !that.telInput.prop("readonly")) {
                        that._showDropdown();
                    }
                });
            }
            // open dropdown list if currently focused
            this.flagsContainer.on("keydown" + that.ns, function(e) {
                var isDropdownHidden = that.countryList.hasClass("hide");
                if (isDropdownHidden && (e.which == keys.UP || e.which == keys.DOWN || e.which == keys.SPACE || e.which == keys.ENTER)) {
                    // prevent form from being submitted if "ENTER" was pressed
                    e.preventDefault();
                    // prevent event from being handled again by document
                    e.stopPropagation();
                    that._showDropdown();
                }
                // allow navigation from dropdown to input on TAB
                if (e.which == keys.TAB) {
                    that._closeDropdown();
                }
            });
        },
        _initRequests: function() {
            var that = this;
            // if the user has specified the path to the utils script, fetch it on window.load
            if (this.options.utilsScript) {
                // if the plugin is being initialised after the window.load event has already been fired
                if (windowLoaded) {
                    this.loadUtils();
                } else {
                    // wait until the load event so we don't block any other requests e.g. the flags image
                    $(window).load(function() {
                        that.loadUtils();
                    });
                }
            } else {
                this.utilsScriptDeferred.resolve();
            }
            if (this.options.defaultCountry == "auto") {
                this._loadAutoCountry();
            } else {
                this.autoCountryDeferred.resolve();
            }
        },
        _loadAutoCountry: function() {
            var that = this;
            // check for cookie
            var cookieAutoCountry = $.cookie ? $.cookie("itiAutoCountry") : "";
            if (cookieAutoCountry) {
                $.fn[pluginName].autoCountry = cookieAutoCountry;
            }
            // 3 options:
            // 1) already loaded (we're done)
            // 2) not already started loading (start)
            // 3) already started loading (do nothing - just wait for loading callback to fire)
            if ($.fn[pluginName].autoCountry) {
                this.autoCountryLoaded();
            } else if (!$.fn[pluginName].startedLoadingAutoCountry) {
                // don't do this twice!
                $.fn[pluginName].startedLoadingAutoCountry = true;
                if (typeof this.options.geoIpLookup === "function") {
                    this.options.geoIpLookup(function(countryCode) {
                        $.fn[pluginName].autoCountry = countryCode.toLowerCase();
                        if ($.cookie) {
                            $.cookie("itiAutoCountry", $.fn[pluginName].autoCountry, {
                                path: "/"
                            });
                        }
                        // tell all instances the auto country is ready
                        // TODO: this should just be the current instances
                        // UPDATE: use setTimeout in case their geoIpLookup function calls this callback straight away (e.g. if they have already done the geo ip lookup somewhere else). Using setTimeout means that the current thread of execution will finish before executing this, which allows the plugin to finish initialising.
                        setTimeout(function() {
                            $(".intl-tel-input input").intlTelInput("autoCountryLoaded");
                        });
                    });
                }
            }
        },
        _initKeyListeners: function() {
            var that = this;
            if (this.options.autoFormat) {
                // format number and update flag on keypress
                // use keypress event as we want to ignore all input except for a select few keys,
                // but we dont want to ignore the navigation keys like the arrows etc.
                // NOTE: no point in refactoring this to only bind these listeners on focus/blur because then you would need to have those 2 listeners running the whole time anyway...
                this.telInput.on("keypress" + this.ns, function(e) {
                    // 32 is space, and after that it's all chars (not meta/nav keys)
                    // this fix is needed for Firefox, which triggers keypress event for some meta/nav keys
                    // Update: also ignore if this is a metaKey e.g. FF and Safari trigger keypress on the v of Ctrl+v
                    // Update: also ignore if ctrlKey (FF on Windows/Ubuntu)
                    // Update: also check that we have utils before we do any autoFormat stuff
                    if (e.which >= keys.SPACE && !e.ctrlKey && !e.metaKey && window.intlTelInputUtils && !that.telInput.prop("readonly")) {
                        e.preventDefault();
                        // allowed keys are just numeric keys and plus
                        // we must allow plus for the case where the user does select-all and then hits plus to start typing a new number. we could refine this logic to first check that the selection contains a plus, but that wont work in old browsers, and I think it's overkill anyway
                        var isAllowedKey = e.which >= keys.ZERO && e.which <= keys.NINE || e.which == keys.PLUS, input = that.telInput[0], noSelection = that.isGoodBrowser && input.selectionStart == input.selectionEnd, max = that.telInput.attr("maxlength"), val = that.telInput.val(), // assumes that if max exists, it is >0
                        isBelowMax = max ? val.length < max : true;
                        // first: ensure we dont go over maxlength. we must do this here to prevent adding digits in the middle of the number
                        // still reformat even if not an allowed key as they could by typing a formatting char, but ignore if there's a selection as doesn't make sense to replace selection with illegal char and then immediately remove it
                        if (isBelowMax && (isAllowedKey || noSelection)) {
                            var newChar = isAllowedKey ? String.fromCharCode(e.which) : null;
                            that._handleInputKey(newChar, true, isAllowedKey);
                            // if something has changed, trigger the input event (which was otherwised squashed by the preventDefault)
                            if (val != that.telInput.val()) {
                                that.telInput.trigger("input");
                            }
                        }
                        if (!isAllowedKey) {
                            that._handleInvalidKey();
                        }
                    }
                });
            }
            // handle cut/paste event (now supported in all major browsers)
            this.telInput.on("cut" + this.ns + " paste" + this.ns, function() {
                // hack because "paste" event is fired before input is updated
                setTimeout(function() {
                    if (that.options.autoFormat && window.intlTelInputUtils) {
                        var cursorAtEnd = that.isGoodBrowser && that.telInput[0].selectionStart == that.telInput.val().length;
                        that._handleInputKey(null, cursorAtEnd);
                        that._ensurePlus();
                    } else {
                        // if no autoFormat, just update flag
                        that._updateFlagFromNumber(that.telInput.val());
                    }
                });
            });
            // handle keyup event
            // if autoFormat enabled: we use keyup to catch delete events (after the fact)
            // if no autoFormat, this is used to update the flag
            this.telInput.on("keyup" + this.ns, function(e) {
                // the "enter" key event from selecting a dropdown item is triggered here on the input, because the document.keydown handler that initially handles that event triggers a focus on the input, and so the keyup for that same key event gets triggered here. weird, but just make sure we dont bother doing any re-formatting in this case (we've already done preventDefault in the keydown handler, so it wont actually submit the form or anything).
                // ALSO: ignore keyup if readonly
                if (e.which == keys.ENTER || that.telInput.prop("readonly")) {} else if (that.options.autoFormat && window.intlTelInputUtils) {
                    // cursorAtEnd defaults to false for bad browsers else they would never get a reformat on delete
                    var cursorAtEnd = that.isGoodBrowser && that.telInput[0].selectionStart == that.telInput.val().length;
                    if (!that.telInput.val()) {
                        // if they just cleared the input, update the flag to the default
                        that._updateFlagFromNumber("");
                    } else if (e.which == keys.DEL && !cursorAtEnd || e.which == keys.BSPACE) {
                        // if delete in the middle: reformat with no suffix (no need to reformat if delete at end)
                        // if backspace: reformat with no suffix (need to reformat if at end to remove any lingering suffix - this is a feature)
                        // important to remember never to add suffix on any delete key as can fuck up in ie8 so you can never delete a formatting char at the end
                        that._handleInputKey();
                    }
                    that._ensurePlus();
                } else {
                    // if no autoFormat, just update flag
                    that._updateFlagFromNumber(that.telInput.val());
                }
            });
        },
        // prevent deleting the plus (if not in nationalMode)
        _ensurePlus: function() {
            if (!this.options.nationalMode) {
                var val = this.telInput.val(), input = this.telInput[0];
                if (val.charAt(0) != "+") {
                    // newCursorPos is current pos + 1 to account for the plus we are about to add
                    var newCursorPos = this.isGoodBrowser ? input.selectionStart + 1 : 0;
                    this.telInput.val("+" + val);
                    if (this.isGoodBrowser) {
                        input.setSelectionRange(newCursorPos, newCursorPos);
                    }
                }
            }
        },
        // alert the user to an invalid key event
        _handleInvalidKey: function() {
            var that = this;
            this.telInput.trigger("invalidkey").addClass("iti-invalid-key");
            setTimeout(function() {
                that.telInput.removeClass("iti-invalid-key");
            }, 100);
        },
        // when autoFormat is enabled: handle various key events on the input:
        // 1) adding a new number character, which will replace any selection, reformat, and preserve the cursor position
        // 2) reformatting on backspace/delete
        // 3) cut/paste event
        _handleInputKey: function(newNumericChar, addSuffix, isAllowedKey) {
            var val = this.telInput.val(), cleanBefore = this._getClean(val), originalLeftChars, // raw DOM element
            input = this.telInput[0], digitsOnRight = 0;
            if (this.isGoodBrowser) {
                // cursor strategy: maintain the number of digits on the right. we use the right instead of the left so that A) we dont have to account for the new digit (or multiple digits if paste event), and B) we're always on the right side of formatting suffixes
                digitsOnRight = this._getDigitsOnRight(val, input.selectionEnd);
                // if handling a new number character: insert it in the right place
                if (newNumericChar) {
                    // replace any selection they may have made with the new char
                    val = val.substr(0, input.selectionStart) + newNumericChar + val.substring(input.selectionEnd, val.length);
                } else {
                    // here we're not handling a new char, we're just doing a re-format (e.g. on delete/backspace/paste, after the fact), but we still need to maintain the cursor position. so make note of the char on the left, and then after the re-format, we'll count in the same number of digits from the right, and then keep going through any formatting chars until we hit the same left char that we had before.
                    // UPDATE: now have to store 2 chars as extensions formatting contains 2 spaces so you need to be able to distinguish
                    originalLeftChars = val.substr(input.selectionStart - 2, 2);
                }
            } else if (newNumericChar) {
                val += newNumericChar;
            }
            // update the number and flag
            this.setNumber(val, null, addSuffix, true, isAllowedKey);
            // update the cursor position
            if (this.isGoodBrowser) {
                var newCursor;
                val = this.telInput.val();
                // if it was at the end, keep it there
                if (!digitsOnRight) {
                    newCursor = val.length;
                } else {
                    // else count in the same number of digits from the right
                    newCursor = this._getCursorFromDigitsOnRight(val, digitsOnRight);
                    // but if delete/paste etc, keep going left until hit the same left char as before
                    if (!newNumericChar) {
                        newCursor = this._getCursorFromLeftChar(val, newCursor, originalLeftChars);
                    }
                }
                // set the new cursor
                input.setSelectionRange(newCursor, newCursor);
            }
        },
        // we start from the position in guessCursor, and work our way left until we hit the originalLeftChars or a number to make sure that after reformatting the cursor has the same char on the left in the case of a delete etc
        _getCursorFromLeftChar: function(val, guessCursor, originalLeftChars) {
            for (var i = guessCursor; i > 0; i--) {
                var leftChar = val.charAt(i - 1);
                if ($.isNumeric(leftChar) || val.substr(i - 2, 2) == originalLeftChars) {
                    return i;
                }
            }
            return 0;
        },
        // after a reformat we need to make sure there are still the same number of digits to the right of the cursor
        _getCursorFromDigitsOnRight: function(val, digitsOnRight) {
            for (var i = val.length - 1; i >= 0; i--) {
                if ($.isNumeric(val.charAt(i))) {
                    if (--digitsOnRight === 0) {
                        return i;
                    }
                }
            }
            return 0;
        },
        // get the number of numeric digits to the right of the cursor so we can reposition the cursor correctly after the reformat has happened
        _getDigitsOnRight: function(val, selectionEnd) {
            var digitsOnRight = 0;
            for (var i = selectionEnd; i < val.length; i++) {
                if ($.isNumeric(val.charAt(i))) {
                    digitsOnRight++;
                }
            }
            return digitsOnRight;
        },
        // listen for focus and blur
        _initFocusListeners: function() {
            var that = this;
            if (this.options.autoHideDialCode) {
                // mousedown decides where the cursor goes, so if we're focusing we must preventDefault as we'll be inserting the dial code, and we want the cursor to be at the end no matter where they click
                this.telInput.on("mousedown" + this.ns, function(e) {
                    if (!that.telInput.is(":focus") && !that.telInput.val()) {
                        e.preventDefault();
                        // but this also cancels the focus, so we must trigger that manually
                        that.telInput.focus();
                    }
                });
            }
            this.telInput.on("focus" + this.ns, function(e) {
                var value = that.telInput.val();
                // save this to compare on blur
                that.telInput.data("focusVal", value);
                // on focus: if empty, insert the dial code for the currently selected flag
                if (that.options.autoHideDialCode && !value && !that.telInput.prop("readonly") && that.selectedCountryData.dialCode) {
                    that._updateVal("+" + that.selectedCountryData.dialCode, null, true);
                    // after auto-inserting a dial code, if the first key they hit is '+' then assume they are entering a new number, so remove the dial code. use keypress instead of keydown because keydown gets triggered for the shift key (required to hit the + key), and instead of keyup because that shows the new '+' before removing the old one
                    that.telInput.one("keypress.plus" + that.ns, function(e) {
                        if (e.which == keys.PLUS) {
                            // if autoFormat is enabled, this key event will have already have been handled by another keypress listener (hence we need to add the "+"). if disabled, it will be handled after this by a keyup listener (hence no need to add the "+").
                            var newVal = that.options.autoFormat && window.intlTelInputUtils ? "+" : "";
                            that.telInput.val(newVal);
                        }
                    });
                    // after tabbing in, make sure the cursor is at the end we must use setTimeout to get outside of the focus handler as it seems the selection happens after that
                    setTimeout(function() {
                        var input = that.telInput[0];
                        if (that.isGoodBrowser) {
                            var len = that.telInput.val().length;
                            input.setSelectionRange(len, len);
                        }
                    });
                }
            });
            this.telInput.on("blur" + this.ns, function() {
                if (that.options.autoHideDialCode) {
                    // on blur: if just a dial code then remove it
                    var value = that.telInput.val(), startsPlus = value.charAt(0) == "+";
                    if (startsPlus) {
                        var numeric = that._getNumeric(value);
                        // if just a plus, or if just a dial code
                        if (!numeric || that.selectedCountryData.dialCode == numeric) {
                            that.telInput.val("");
                        }
                    }
                    // remove the keypress listener we added on focus
                    that.telInput.off("keypress.plus" + that.ns);
                }
                // if autoFormat, we must manually trigger change event if value has changed
                if (that.options.autoFormat && window.intlTelInputUtils && that.telInput.val() != that.telInput.data("focusVal")) {
                    that.telInput.trigger("change");
                }
            });
        },
        // extract the numeric digits from the given string
        _getNumeric: function(s) {
            return s.replace(/\D/g, "");
        },
        _getClean: function(s) {
            var prefix = s.charAt(0) == "+" ? "+" : "";
            return prefix + this._getNumeric(s);
        },
        // show the dropdown
        _showDropdown: function() {
            this._setDropdownPosition();
            // update highlighting and scroll to active list item
            var activeListItem = this.countryList.children(".active");
            if (activeListItem.length) {
                this._highlightListItem(activeListItem);
            }
            // show it
            this.countryList.removeClass("hide");
            if (activeListItem.length) {
                this._scrollTo(activeListItem);
            }
            // bind all the dropdown-related listeners: mouseover, click, click-off, keydown
            this._bindDropdownListeners();
            // update the arrow
            this.selectedFlagInner.children(".arrow").addClass("up");
        },
        // decide where to position dropdown (depends on position within viewport, and scroll)
        _setDropdownPosition: function() {
            var inputTop = this.telInput.offset().top, windowTop = $(window).scrollTop(), // dropdownFitsBelow = (dropdownBottom < windowBottom)
            dropdownFitsBelow = inputTop + this.telInput.outerHeight() + this.dropdownHeight < windowTop + $(window).height(), dropdownFitsAbove = inputTop - this.dropdownHeight > windowTop;
            // dropdownHeight - 1 for border
            var cssTop = !dropdownFitsBelow && dropdownFitsAbove ? "-" + (this.dropdownHeight - 1) + "px" : "";
            this.countryList.css("top", cssTop);
        },
        // we only bind dropdown listeners when the dropdown is open
        _bindDropdownListeners: function() {
            var that = this;
            // when mouse over a list item, just highlight that one
            // we add the class "highlight", so if they hit "enter" we know which one to select
            this.countryList.on("mouseover" + this.ns, ".country", function(e) {
                that._highlightListItem($(this));
            });
            // listen for country selection
            this.countryList.on("click" + this.ns, ".country", function(e) {
                that._selectListItem($(this));
            });
            // click off to close
            // (except when this initial opening click is bubbling up)
            // we cannot just stopPropagation as it may be needed to close another instance
            var isOpening = true;
            $("html").on("click" + this.ns, function(e) {
                if (!isOpening) {
                    that._closeDropdown();
                }
                isOpening = false;
            });
            // listen for up/down scrolling, enter to select, or letters to jump to country name.
            // use keydown as keypress doesn't fire for non-char keys and we want to catch if they
            // just hit down and hold it to scroll down (no keyup event).
            // listen on the document because that's where key events are triggered if no input has focus
            var query = "", queryTimer = null;
            $(document).on("keydown" + this.ns, function(e) {
                // prevent down key from scrolling the whole page,
                // and enter key from submitting a form etc
                e.preventDefault();
                if (e.which == keys.UP || e.which == keys.DOWN) {
                    // up and down to navigate
                    that._handleUpDownKey(e.which);
                } else if (e.which == keys.ENTER) {
                    // enter to select
                    that._handleEnterKey();
                } else if (e.which == keys.ESC) {
                    // esc to close
                    that._closeDropdown();
                } else if (e.which >= keys.A && e.which <= keys.Z || e.which == keys.SPACE) {
                    // upper case letters (note: keyup/keydown only return upper case letters)
                    // jump to countries that start with the query string
                    if (queryTimer) {
                        clearTimeout(queryTimer);
                    }
                    query += String.fromCharCode(e.which);
                    that._searchForCountry(query);
                    // if the timer hits 1 second, reset the query
                    queryTimer = setTimeout(function() {
                        query = "";
                    }, 1e3);
                }
            });
        },
        // highlight the next/prev item in the list (and ensure it is visible)
        _handleUpDownKey: function(key) {
            var current = this.countryList.children(".highlight").first();
            var next = key == keys.UP ? current.prev() : current.next();
            if (next.length) {
                // skip the divider
                if (next.hasClass("divider")) {
                    next = key == keys.UP ? next.prev() : next.next();
                }
                this._highlightListItem(next);
                this._scrollTo(next);
            }
        },
        // select the currently highlighted item
        _handleEnterKey: function() {
            var currentCountry = this.countryList.children(".highlight").first();
            if (currentCountry.length) {
                this._selectListItem(currentCountry);
            }
        },
        // find the first list item whose name starts with the query string
        _searchForCountry: function(query) {
            for (var i = 0; i < this.countries.length; i++) {
                if (this._startsWith(this.countries[i].name, query)) {
                    var listItem = this.countryList.children("[data-country-code=" + this.countries[i].iso2 + "]").not(".preferred");
                    // update highlighting and scroll
                    this._highlightListItem(listItem);
                    this._scrollTo(listItem, true);
                    break;
                }
            }
        },
        // check if (uppercase) string a starts with string b
        _startsWith: function(a, b) {
            return a.substr(0, b.length).toUpperCase() == b;
        },
        // update the input's value to the given val
        // if autoFormat=true, format it first according to the country-specific formatting rules
        // Note: preventConversion will be false (i.e. we allow conversion) on init and when dev calls public method setNumber
        _updateVal: function(val, format, addSuffix, preventConversion, isAllowedKey) {
            var formatted;
            if (this.options.autoFormat && window.intlTelInputUtils && this.selectedCountryData) {
                if (typeof format == "number" && intlTelInputUtils.isValidNumber(val, this.selectedCountryData.iso2)) {
                    // if user specified a format, and it's a valid number, then format it accordingly
                    formatted = intlTelInputUtils.formatNumberByType(val, this.selectedCountryData.iso2, format);
                } else if (!preventConversion && this.options.nationalMode && val.charAt(0) == "+" && intlTelInputUtils.isValidNumber(val, this.selectedCountryData.iso2)) {
                    // if nationalMode and we have a valid intl number, convert it to ntl
                    formatted = intlTelInputUtils.formatNumberByType(val, this.selectedCountryData.iso2, intlTelInputUtils.numberFormat.NATIONAL);
                } else {
                    // else do the regular AsYouType formatting
                    formatted = intlTelInputUtils.formatNumber(val, this.selectedCountryData.iso2, addSuffix, this.options.allowExtensions, isAllowedKey);
                }
                // ensure we dont go over maxlength. we must do this here to truncate any formatting suffix, and also handle paste events
                var max = this.telInput.attr("maxlength");
                if (max && formatted.length > max) {
                    formatted = formatted.substr(0, max);
                }
            } else {
                // no autoFormat, so just insert the original value
                formatted = val;
            }
            this.telInput.val(formatted);
        },
        // check if need to select a new flag based on the given number
        _updateFlagFromNumber: function(number, updateDefault) {
            // if we're in nationalMode and we're on US/Canada, make sure the number starts with a +1 so _getDialCode will be able to extract the area code
            // update: if we dont yet have selectedCountryData, but we're here (trying to update the flag from the number), that means we're initialising the plugin with a number that already has a dial code, so fine to ignore this bit
            if (number && this.options.nationalMode && this.selectedCountryData && this.selectedCountryData.dialCode == "1" && number.charAt(0) != "+") {
                if (number.charAt(0) != "1") {
                    number = "1" + number;
                }
                number = "+" + number;
            }
            // try and extract valid dial code from input
            var dialCode = this._getDialCode(number), countryCode = null;
            if (dialCode) {
                // check if one of the matching countries is already selected
                var countryCodes = this.countryCodes[this._getNumeric(dialCode)], alreadySelected = this.selectedCountryData && $.inArray(this.selectedCountryData.iso2, countryCodes) != -1;
                // if a matching country is not already selected (or this is an unknown NANP area code): choose the first in the list
                if (!alreadySelected || this._isUnknownNanp(number, dialCode)) {
                    // if using onlyCountries option, countryCodes[0] may be empty, so we must find the first non-empty index
                    for (var j = 0; j < countryCodes.length; j++) {
                        if (countryCodes[j]) {
                            countryCode = countryCodes[j];
                            break;
                        }
                    }
                }
            } else if (number.charAt(0) == "+" && this._getNumeric(number).length) {
                // invalid dial code, so empty
                // Note: use getNumeric here because the number has not been formatted yet, so could contain bad shit
                countryCode = "";
            } else if (!number || number == "+") {
                // empty, or just a plus, so default
                countryCode = this.options.defaultCountry.iso2;
            }
            if (countryCode !== null) {
                this._selectFlag(countryCode, updateDefault);
            }
        },
        // check if the given number contains an unknown area code from the North American Numbering Plan i.e. the only dialCode that could be extracted was +1 but the actual number's length is >=4
        _isUnknownNanp: function(number, dialCode) {
            return dialCode == "+1" && this._getNumeric(number).length >= 4;
        },
        // remove highlighting from other list items and highlight the given item
        _highlightListItem: function(listItem) {
            this.countryListItems.removeClass("highlight");
            listItem.addClass("highlight");
        },
        // find the country data for the given country code
        // the ignoreOnlyCountriesOption is only used during init() while parsing the onlyCountries array
        _getCountryData: function(countryCode, ignoreOnlyCountriesOption, allowFail) {
            var countryList = ignoreOnlyCountriesOption ? allCountries : this.countries;
            for (var i = 0; i < countryList.length; i++) {
                if (countryList[i].iso2 == countryCode) {
                    return countryList[i];
                }
            }
            if (allowFail) {
                return null;
            } else {
                throw new Error("No country data for '" + countryCode + "'");
            }
        },
        // select the given flag, update the placeholder and the active list item
        _selectFlag: function(countryCode, updateDefault) {
            // do this first as it will throw an error and stop if countryCode is invalid
            this.selectedCountryData = countryCode ? this._getCountryData(countryCode, false, false) : {};
            // update the "defaultCountry" - we only need the iso2 from now on, so just store that
            if (updateDefault && this.selectedCountryData.iso2) {
                // can't just make this equal to selectedCountryData as would be a ref to that object
                this.options.defaultCountry = {
                    iso2: this.selectedCountryData.iso2
                };
            }
            this.selectedFlagInner.attr("class", "iti-flag " + countryCode);
            // update the selected country's title attribute
            var title = countryCode ? this.selectedCountryData.name + ": +" + this.selectedCountryData.dialCode : "Unknown";
            this.selectedFlagInner.parent().attr("title", title);
            // and the input's placeholder
            this._updatePlaceholder();
            if (this.isMobile) {
                this.countryList.val(countryCode);
            } else {
                // update the active list item
                this.countryListItems.removeClass("active");
                if (countryCode) {
                    this.countryListItems.find(".iti-flag." + countryCode).first().closest(".country").addClass("active");
                }
            }
        },
        // update the input placeholder to an example number from the currently selected country
        _updatePlaceholder: function() {
            if (window.intlTelInputUtils && !this.hadInitialPlaceholder && this.options.autoPlaceholder && this.selectedCountryData) {
                var iso2 = this.selectedCountryData.iso2, numberType = intlTelInputUtils.numberType[this.options.numberType || "FIXED_LINE"], placeholder = iso2 ? intlTelInputUtils.getExampleNumber(iso2, this.options.nationalMode, numberType) : "";
                this.telInput.attr("placeholder", placeholder);
            }
        },
        // called when the user selects a list item from the dropdown
        _selectListItem: function(listItem) {
            var countryCodeAttr = this.isMobile ? "value" : "data-country-code";
            // update selected flag and active list item
            this._selectFlag(listItem.attr(countryCodeAttr), true);
            if (!this.isMobile) {
                this._closeDropdown();
            }
            this._updateDialCode(listItem.attr("data-dial-code"), true);
            // always fire the change event as even if nationalMode=true (and we haven't updated the input val), the system as a whole has still changed - see country-sync example. think of it as making a selection from a select element.
            this.telInput.trigger("change");
            // focus the input
            this.telInput.focus();
            // fix for FF and IE11 (with nationalMode=false i.e. auto inserting dial code), who try to put the cursor at the beginning the first time
            if (this.isGoodBrowser) {
                var len = this.telInput.val().length;
                this.telInput[0].setSelectionRange(len, len);
            }
        },
        // close the dropdown and unbind any listeners
        _closeDropdown: function() {
            this.countryList.addClass("hide");
            // update the arrow
            this.selectedFlagInner.children(".arrow").removeClass("up");
            // unbind key events
            $(document).off(this.ns);
            // unbind click-off-to-close
            $("html").off(this.ns);
            // unbind hover and click listeners
            this.countryList.off(this.ns);
        },
        // check if an element is visible within it's container, else scroll until it is
        _scrollTo: function(element, middle) {
            var container = this.countryList, containerHeight = container.height(), containerTop = container.offset().top, containerBottom = containerTop + containerHeight, elementHeight = element.outerHeight(), elementTop = element.offset().top, elementBottom = elementTop + elementHeight, newScrollTop = elementTop - containerTop + container.scrollTop(), middleOffset = containerHeight / 2 - elementHeight / 2;
            if (elementTop < containerTop) {
                // scroll up
                if (middle) {
                    newScrollTop -= middleOffset;
                }
                container.scrollTop(newScrollTop);
            } else if (elementBottom > containerBottom) {
                // scroll down
                if (middle) {
                    newScrollTop += middleOffset;
                }
                var heightDifference = containerHeight - elementHeight;
                container.scrollTop(newScrollTop - heightDifference);
            }
        },
        // replace any existing dial code with the new one (if not in nationalMode)
        // also we need to know if we're focusing for a couple of reasons e.g. if so, we want to add any formatting suffix, also if the input is empty and we're not in nationalMode, then we want to insert the dial code
        _updateDialCode: function(newDialCode, focusing) {
            var inputVal = this.telInput.val(), newNumber;
            // save having to pass this every time
            newDialCode = "+" + newDialCode;
            if (this.options.nationalMode && inputVal.charAt(0) != "+") {
                // if nationalMode, we just want to re-format
                newNumber = inputVal;
            } else if (inputVal) {
                // if the previous number contained a valid dial code, replace it
                // (if more than just a plus character)
                var prevDialCode = this._getDialCode(inputVal);
                if (prevDialCode.length > 1) {
                    newNumber = inputVal.replace(prevDialCode, newDialCode);
                } else {
                    // if the previous number didn't contain a dial code, we should persist it
                    var existingNumber = inputVal.charAt(0) != "+" ? $.trim(inputVal) : "";
                    newNumber = newDialCode + existingNumber;
                }
            } else {
                newNumber = !this.options.autoHideDialCode || focusing ? newDialCode : "";
            }
            this._updateVal(newNumber, null, focusing);
        },
        // try and extract a valid international dial code from a full telephone number
        // Note: returns the raw string inc plus character and any whitespace/dots etc
        _getDialCode: function(number) {
            var dialCode = "";
            // only interested in international numbers (starting with a plus)
            if (number.charAt(0) == "+") {
                var numericChars = "";
                // iterate over chars
                for (var i = 0; i < number.length; i++) {
                    var c = number.charAt(i);
                    // if char is number
                    if ($.isNumeric(c)) {
                        numericChars += c;
                        // if current numericChars make a valid dial code
                        if (this.countryCodes[numericChars]) {
                            // store the actual raw string (useful for matching later)
                            dialCode = number.substr(0, i + 1);
                        }
                        // longest dial code is 4 chars
                        if (numericChars.length == 4) {
                            break;
                        }
                    }
                }
            }
            return dialCode;
        },
        /********************
   *  PUBLIC METHODS
   ********************/
        // this is called when the geoip call returns
        autoCountryLoaded: function() {
            if (this.options.defaultCountry == "auto") {
                this.options.defaultCountry = $.fn[pluginName].autoCountry;
                this._setInitialState();
                this.autoCountryDeferred.resolve();
            }
        },
        // remove plugin
        destroy: function() {
            if (!this.isMobile) {
                // make sure the dropdown is closed (and unbind listeners)
                this._closeDropdown();
            }
            // key events, and focus/blur events if autoHideDialCode=true
            this.telInput.off(this.ns);
            if (this.isMobile) {
                // change event on select country
                this.countryList.off(this.ns);
            } else {
                // click event to open dropdown
                this.selectedFlagInner.parent().off(this.ns);
                // label click hack
                this.telInput.closest("label").off(this.ns);
            }
            // remove markup
            var container = this.telInput.parent();
            container.before(this.telInput).remove();
        },
        // extract the phone number extension if present
        getExtension: function() {
            return this.telInput.val().split(" ext. ")[1] || "";
        },
        // format the number to the given type
        getNumber: function(type) {
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.formatNumberByType(this.telInput.val(), this.selectedCountryData.iso2, type);
            }
            return "";
        },
        // get the type of the entered number e.g. landline/mobile
        getNumberType: function() {
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.getNumberType(this.telInput.val(), this.selectedCountryData.iso2);
            }
            return -99;
        },
        // get the country data for the currently selected flag
        getSelectedCountryData: function() {
            // if this is undefined, the plugin will return it's instance instead, so in that case an empty object makes more sense
            return this.selectedCountryData || {};
        },
        // get the validation error
        getValidationError: function() {
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.getValidationError(this.telInput.val(), this.selectedCountryData.iso2);
            }
            return -99;
        },
        // validate the input val - assumes the global function isValidNumber (from utilsScript)
        isValidNumber: function() {
            var val = $.trim(this.telInput.val()), countryCode = this.options.nationalMode ? this.selectedCountryData.iso2 : "";
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.isValidNumber(val, countryCode);
            }
            return false;
        },
        // load the utils script
        loadUtils: function(path) {
            var that = this;
            var utilsScript = path || this.options.utilsScript;
            if (!$.fn[pluginName].loadedUtilsScript && utilsScript) {
                // don't do this twice! (dont just check if the global intlTelInputUtils exists as if init plugin multiple times in quick succession, it may not have finished loading yet)
                $.fn[pluginName].loadedUtilsScript = true;
                // dont use $.getScript as it prevents caching
                $.ajax({
                    url: utilsScript,
                    success: function() {
                        // tell all instances the utils are ready
                        $(".intl-tel-input input").intlTelInput("utilsLoaded");
                    },
                    complete: function() {
                        that.utilsScriptDeferred.resolve();
                    },
                    dataType: "script",
                    cache: true
                });
            } else {
                this.utilsScriptDeferred.resolve();
            }
        },
        // update the selected flag, and update the input val accordingly
        selectCountry: function(countryCode) {
            countryCode = countryCode.toLowerCase();
            // check if already selected
            if (!this.selectedFlagInner.hasClass(countryCode)) {
                this._selectFlag(countryCode, true);
                this._updateDialCode(this.selectedCountryData.dialCode, false);
            }
        },
        // set the input value and update the flag
        setNumber: function(number, format, addSuffix, preventConversion, isAllowedKey) {
            // ensure starts with plus
            if (!this.options.nationalMode && number.charAt(0) != "+") {
                number = "+" + number;
            }
            // we must update the flag first, which updates this.selectedCountryData, which is used later for formatting the number before displaying it
            this._updateFlagFromNumber(number);
            this._updateVal(number, format, addSuffix, preventConversion, isAllowedKey);
        },
        // this is called when the utils are ready
        utilsLoaded: function() {
            // if autoFormat is enabled and there's an initial value in the input, then format it
            if (this.options.autoFormat && this.telInput.val()) {
                this._updateVal(this.telInput.val());
            }
            this._updatePlaceholder();
        }
    };
    // adapted to allow public functions
    // using https://github.com/jquery-boilerplate/jquery-boilerplate/wiki/Extending-jQuery-Boilerplate
    $.fn[pluginName] = function(options) {
        var args = arguments;
        // Is the first parameter an object (options), or was omitted,
        // instantiate a new instance of the plugin.
        if (options === undefined || typeof options === "object") {
            var deferreds = [];
            this.each(function() {
                if (!$.data(this, "plugin_" + pluginName)) {
                    var instance = new Plugin(this, options);
                    var instanceDeferreds = instance._init();
                    // we now have 2 deffereds: 1 for auto country, 1 for utils script
                    deferreds.push(instanceDeferreds[0]);
                    deferreds.push(instanceDeferreds[1]);
                    $.data(this, "plugin_" + pluginName, instance);
                }
            });
            // return the promise from the "master" deferred object that tracks all the others
            return $.when.apply(null, deferreds);
        } else if (typeof options === "string" && options[0] !== "_") {
            // If the first parameter is a string and it doesn't start
            // with an underscore or "contains" the `init`-function,
            // treat this as a call to a public method.
            // Cache the method call to make it possible to return a value
            var returns;
            this.each(function() {
                var instance = $.data(this, "plugin_" + pluginName);
                // Tests that there's already a plugin-instance
                // and checks that the requested public method exists
                if (instance instanceof Plugin && typeof instance[options] === "function") {
                    // Call the method of our plugin instance,
                    // and pass it the supplied arguments.
                    returns = instance[options].apply(instance, Array.prototype.slice.call(args, 1));
                }
                // Allow instances to be destroyed via the 'destroy' method
                if (options === "destroy") {
                    $.data(this, "plugin_" + pluginName, null);
                }
            });
            // If the earlier cached method gives a value back return the value,
            // otherwise return this to preserve chainability.
            return returns !== undefined ? returns : this;
        }
    };
    /********************
 *  STATIC METHODS
 ********************/
    // get the country data object
    $.fn[pluginName].getCountryData = function() {
        return allCountries;
    };
    $.fn[pluginName].version = "6.0.6";
    // Tell JSHint to ignore this warning: "character may get silently deleted by one or more browsers"
    // jshint -W100
    // Array of country objects for the flag dropdown.
    // Each contains a name, country code (ISO 3166-1 alpha-2) and dial code.
    // Originally from https://github.com/mledoze/countries
    // then modified using the following JavaScript (NOW OUT OF DATE):
    /*
var result = [];
_.each(countries, function(c) {
  // ignore countries without a dial code
  if (c.callingCode[0].length) {
    result.push({
      // var locals contains country names with localised versions in brackets
      n: _.findWhere(locals, {
        countryCode: c.cca2
      }).name,
      i: c.cca2.toLowerCase(),
      d: c.callingCode[0]
    });
  }
});
JSON.stringify(result);
*/
    // then with a couple of manual re-arrangements to be alphabetical
    // then changed Kazakhstan from +76 to +7
    // and Vatican City from +379 to +39 (see issue 50)
    // and Caribean Netherlands from +5997 to +599
    // and Curacao from +5999 to +599
    // Removed: Åland Islands, Christmas Island, Cocos Islands, Guernsey, Isle of Man, Jersey, Kosovo, Mayotte, Pitcairn Islands, South Georgia, Svalbard, Western Sahara
    // Update: converted objects to arrays to save bytes!
    // Update: added "priority" for countries with the same dialCode as others
    // Update: added array of area codes for countries with the same dialCode as others
    // So each country array has the following information:
    // [
    //    Country name,
    //    iso2 code,
    //    International dial code,
    //    Order (if >1 country with same dial code),
    //    Area codes (if >1 country with same dial code)
    // ]
    var allCountries = [  [ "China (中国)", "cn", "86" ],[ "Hong Kong (香港)", "hk", "852" ],[ "Macau(澳门)", "mac", "853" ], [ "Taiwan (台湾)", "tw", "886" ],[ "United States(美国)", "us", "1", 0 ], [ "South Korea (韩国)", "kr", "82" ],[ "Thailand (泰国)", "th", "66" ],[ "North Korea (北朝鲜)", "kp", "850" ],[ "Afghanistan (阿富汗)", "af", "93" ], [ "Albania (阿尔巴尼亚)", "al", "355" ], [ "Algeria (阿尔及利亚)", "dz", "213" ], [ "American Samoa(美属萨摩亚群岛)", "as", "1684" ], [ "Andorra(安道尔)", "ad", "376" ], [ "Angola(安哥拉)", "ao", "244" ], [ "Anguilla(安圭拉)", "ai", "1264" ], [ "Antigua and Barbuda(安提瓜和巴布达)", "ag", "1268" ], [ "Argentina(阿根廷)", "ar", "54" ], [ "Armenia (亚美尼亚)", "am", "374" ], [ "Aruba(阿鲁巴)", "aw", "297" ], [ "Australia(澳大利亚)", "au", "61" ], [ "Austria (奥地利)", "at", "43" ], [ "Azerbaijan (阿塞拜疆)", "az", "994" ], [ "Bahamas(巴哈马)", "bs", "1242" ], [ "Bahrain (巴林)", "bh", "973" ], [ "Bangladesh (孟加拉)", "bd", "880" ], [ "Barbados(巴巴多斯岛)", "bb", "1246" ], [ "Belarus(白俄罗斯)", "by", "375" ], [ "Belgium (比利时)", "be", "32" ], [ "Belize(伯利兹)", "bz", "501" ], [ "Benin (贝宁)", "bj", "229" ], [ "Bermuda(百慕大)", "bm", "1441" ], [ "Bhutan (不丹)", "bt", "975" ], [ "Bolivia(玻利维亚)", "bo", "591" ], [ "Bosnia and Herzegovina (波斯尼亚和黑塞哥维那)", "ba", "387" ], [ "Botswana(博兹瓦纳)", "bw", "267" ], [ "Brazil (巴西)", "br", "55" ], [ "British Indian Ocean Territory(英属印度洋领地)", "io", "246" ], [ "British Virgin Islands(英属维京群岛)", "vg", "1284" ], [ "Brunei(文莱)", "bn", "673" ], [ "Bulgaria (保加利亚)", "bg", "359" ], [ "Burkina Faso(布基纳法索)", "bf", "226" ], [ "Burundi (布隆迪)", "bi", "257" ], [ "Cambodia (柬埔寨)", "kh", "855" ], [ "Cameroon (喀麦隆)", "cm", "237" ], [ "Canada(加拿大)", "ca", "1", 1, [ "204", "226", "236", "249", "250", "289", "306", "343", "365", "387", "403", "416", "418", "431", "437", "438", "450", "506", "514", "519", "548", "579", "581", "587", "604", "613", "639", "647", "672", "705", "709", "742", "778", "780", "782", "807", "819", "825", "867", "873", "902", "905" ] ], [ "Cape Verde (佛得角)", "cv", "238" ], [ "Caribbean Netherlands(荷兰加勒比区)", "bq", "599", 1 ], [ "Cayman Islands(开曼群岛)", "ky", "1345" ], [ "Central African Republic (中非共和国)", "cf", "236" ], [ "Chad (乍得)", "td", "235" ], [ "Chile(智利)", "cl", "56" ], [ "Colombia(哥伦比亚)", "co", "57" ], [ "Comoros (‫科摩罗)", "km", "269" ], [ "Democratic Republic of the Congo(刚果民主共和国)", "cd", "243" ], [ "Congo-Brazzaville (刚果共和国)", "cg", "242" ], [ "Cook Islands(库克群岛)", "ck", "682" ], [ "Costa Rica(哥斯达黎加)", "cr", "506" ], [ "Côte d’Ivoire(科特迪瓦)", "ci", "225" ], [ "Croatia(Hrvatska)(克罗地亚)", "hr", "385" ], [ "Cuba(古巴)", "cu", "53" ], [ "Curaçao(库拉索岛)", "cw", "599", 0 ], [ "Cyprus (塞浦路斯共和国)", "cy", "357" ], [ "Czech Republic (捷克)", "cz", "420" ], [ "Denmark (丹麦)", "dk", "45" ], [ "Djibouti(吉布提)", "dj", "253" ], [ "Dominica(多米尼加)", "dm", "1767" ], [ "Dominican Republic (多米尼加共和国)", "do", "1", 2, [ "809", "829", "849" ] ], [ "Ecuador(厄瓜多尔)", "ec", "593" ], [ "Egypt (‫埃及)", "eg", "20" ], [ "El Salvador(萨尔瓦多)", "sv", "503" ], [ "Equatorial Guinea (赤道几内亚)", "gq", "240" ], [ "Eritrea(厄立特里亚)", "er", "291" ], [ "Estonia (爱沙尼亚)", "ee", "372" ], [ "Ethiopia(埃塞俄比亚)", "et", "251" ], [ "Falkland Islands (福克兰群岛)", "fk", "500" ], [ "Faroe Islands (法罗群岛)", "fo", "298" ], [ "Fiji(斐济)", "fj", "679" ], [ "Finland (芬兰)", "fi", "358" ], [ "France(法国)", "fr", "33" ], [ "French Guiana (法属圭亚那)", "gf", "594" ], [ "French Polynesia (法属波利尼西亚)", "pf", "689" ], [ "Gabon(加蓬)", "ga", "241" ], [ "Gambia(冈比亚)", "gm", "220" ], [ "Georgia (格鲁吉亚)", "ge", "995" ], [ "Germany (德国)", "de", "49" ], [ "Ghana (加纳)", "gh", "233" ], [ "Gibraltar(直布罗陀)", "gi", "350" ], [ "Greece (希腊)", "gr", "30" ], [ "Greenland (格陵兰岛)", "gl", "299" ], [ "Grenada(格林纳达)", "gd", "1473" ], [ "Guadeloupe(瓜德罗普)", "gp", "590", 0 ], [ "Guam(关岛)", "gu", "1671" ], [ "Guatemala(危地马拉共和国)", "gt", "502" ], [ "Guinea (几内亚)", "gn", "224" ], [ "Guinea-Bissau (几内亚比绍)", "gw", "245" ], [ "Guyana(圭亚那)", "gy", "592" ], [ "Haiti(海地)", "ht", "509" ], [ "Honduras(洪都拉斯)", "hn", "504" ],  [ "Hungary (匈牙利)", "hu", "36" ], [ "Iceland (冰岛)", "is", "354" ], [ "India (印度)", "in", "91" ], [ "Indonesia(印度尼西亚)", "id", "62" ], [ "Iran (‫伊朗)", "ir", "98" ], [ "Iraq (‫伊拉克)", "iq", "964" ], [ "Ireland(爱尔兰)", "ie", "353" ], [ "Israel (‫以色列)", "il", "972" ], [ "Italy (意大利)", "it", "39", 0 ], [ "Jamaica(牙买加)", "jm", "1876" ], [ "Japan (日本)", "jp", "81" ], [ "Jordan (‫约旦)", "jo", "962" ], [ "Kazakhstan (哈萨克斯坦)", "kz", "7", 1 ], [ "Kenya(肯尼亚)", "ke", "254" ], [ "Kiribati(基里巴斯)", "ki", "686" ], [ "Kuwait (‫科威特)", "kw", "965" ], [ "Kyrgyzstan (吉尔吉斯)", "kg", "996" ], [ "Laos (老挝)", "la", "856" ], [ "Latvia (拉脱维亚)", "lv", "371" ], [ "Lebanon (‫黎巴嫩)", "lb", "961" ], [ "Lesotho(莱索托)", "ls", "266" ], [ "Liberia(利比里亚)", "lr", "231" ], [ "Libya (‫利比亚)", "ly", "218" ], [ "Liechtenstein(列支敦士登公国)", "li", "423" ], [ "Lithuania (立陶宛)", "lt", "370" ], [ "Luxembourg(卢森堡公国)", "lu", "352" ], [ "Macau (澳門)", "mo", "853" ], [ "Macedonia (FYROM) (马其顿)", "mk", "389" ], [ "Madagascar (马达加斯加岛)", "mg", "261" ], [ "Malawi(马拉维)", "mw", "265" ], [ "Malaysia(马来西亚)", "my", "60" ], [ "Maldives(马尔代夫)", "mv", "960" ], [ "Mali(马里)", "ml", "223" ], [ "Malta(马耳他)", "mt", "356" ], [ "Marshall Islands(马绍尔群岛)", "mh", "692" ], [ "Martinique(马提尼克岛)", "mq", "596" ], [ "Mauritania (‫毛利塔尼亚)", "mr", "222" ], [ "Mauritius (毛里求斯)", "mu", "230" ], [ "Mexico (墨西哥)", "mx", "52" ], [ "Micronesia(密克罗尼西亚)", "fm", "691" ], [ "Moldova (摩尔多瓦)", "md", "373" ], [ "Monaco(摩纳哥)", "mc", "377" ], [ "Mongolia (蒙古)", "mn", "976" ], [ "Montenegro (黑山共和国)", "me", "382" ], [ "Montserrat(蒙特塞拉特)", "ms", "1664" ], [ "Morocco (‫摩洛哥)", "ma", "212" ], [ "Mozambique (莫桑比克)", "mz", "258" ], [ "Myanmar(缅甸)", "mm", "95" ], [ "Namibia (纳米比亚)", "na", "264" ], [ "Nauru(瑙鲁)", "nr", "674" ], [ "Nepal (尼泊尔)", "np", "977" ], [ "Netherlands (荷兰)", "nl", "31" ], [ "New Caledonia (新喀里多尼亚)", "nc", "687" ], [ "New Zealand(新西兰)", "nz", "64" ], [ "Nicaragua(尼加拉瓜)", "ni", "505" ], [ "Niger (尼日尔)", "ne", "227" ], [ "Nigeria(尼日利亚)", "ng", "234" ], [ "Niue(纽埃)", "nu", "683" ], [ "Norfolk Island(诺福克岛)", "nf", "672" ],  [ "Northern Mariana Islands(北马里亚那群岛)", "mp", "1670" ], [ "Norway (挪威王国)", "no", "47" ], [ "Oman (‫阿曼)", "om", "968" ], [ "Pakistan (‫巴基斯坦)", "pk", "92" ], [ "Palau(帕劳)", "pw", "680" ], [ "Palestine (‫巴勒斯坦)", "ps", "970" ], [ "Panama (巴拿马)", "pa", "507" ], [ "Papua New Guinea(巴布亚新几内亚)", "pg", "675" ], [ "Paraguay(巴拉圭)", "py", "595" ], [ "Peru (秘鲁)", "pe", "51" ], [ "Philippines(菲律宾)", "ph", "63" ], [ "Poland (波兰)", "pl", "48" ], [ "Portugal(葡萄牙)", "pt", "351" ], [ "Puerto Rico(波多黎各)", "pr", "1", 3, [ "787", "939" ] ], [ "Qatar (‫卡塔尔)", "qa", "974" ], [ "Réunion (留尼旺)", "re", "262" ], [ "Romania (罗马尼亚)", "ro", "40" ], [ "Russia (俄罗斯)", "ru", "7", 0 ], [ "Rwanda(卢旺达)", "rw", "250" ], [ "Saint Barthélemy (圣巴托洛缪)", "bl", "590", 1 ], [ "Saint Helena(圣赫勒拿岛)", "sh", "290" ], [ "Saint Kitts and Nevis(圣克里斯托弗和尼维斯岛)", "kn", "1869" ], [ "Saint Lucia(圣卢西亚岛)", "lc", "1758" ], [ "Saint Martin (圣马丁)", "mf", "590", 2 ], [ "Saint Pierre and Miquelon (圣皮埃尔和密克隆)", "pm", "508" ], [ "Saint Vincent and the Grenadines(圣文森特和格林纳丁斯)", "vc", "1784" ], [ "Samoa(萨摩亚群岛)", "ws", "685" ], [ "San Marino(圣马力诺)", "sm", "378" ], [ "São Tomé and Príncipe (圣多美和普林西比多布拉)", "st", "239" ], [ "Saudi Arabia (‫沙特阿拉伯)", "sa", "966" ], [ "Senegal (塞内加尔)", "sn", "221" ], [ "Serbia (塞尔维亚)", "rs", "381" ], [ "Seychelles(塞舌尔)", "sc", "248" ], [ "Sierra Leone(塞拉利昂)", "sl", "232" ], [ "Singapore(新加坡)", "sg", "65" ], [ "Sint Maarten(荷属圣马丁)", "sx", "1721" ], [ "Slovakia (斯洛伐克)", "sk", "421" ], [ "Slovenia (斯洛文尼亚)", "si", "386" ], [ "Solomon Islands(所罗门群岛)", "sb", "677" ], [ "Somalia (索马里)", "so", "252" ], [ "South Africa(南非)", "za", "27" ], [ "South Sudan (‫南苏丹)", "ss", "211" ], [ "Spain (西班牙)", "es", "34" ], [ "Sri Lanka (斯里兰卡)", "lk", "94" ], [ "Sudan (‫苏丹)", "sd", "249" ], [ "Suriname(苏里南)", "sr", "597" ], [ "Swaziland(斯威士兰)", "sz", "268" ], [ "Sweden (瑞典)", "se", "46" ], [ "Switzerland (瑞士)", "ch", "41" ], [ "Syria (‫叙利亚)", "sy", "963" ], [ "Tajikistan(塔吉克斯坦)", "tj", "992" ], [ "Tanzania(坦桑尼亚)", "tz", "255" ],  [ "Timor-Leste(东帝汶)", "tl", "670" ], [ "Togo(多哥)", "tg", "228" ], [ "Tokelau(托克劳)", "tk", "690" ], [ "Tonga(汤加)", "to", "676" ], [ "Trinidad and Tobago(特立尼达和多巴哥)", "tt", "1868" ], [ "Tunisia (‫突尼斯)", "tn", "216" ], [ "Turkey (土耳其)", "tr", "90" ], [ "Turkmenistan(土库曼斯坦)", "tm", "993" ], [ "Turks and Caicos Islands(特克斯和凯科斯群岛)", "tc", "1649" ], [ "Tuvalu(图瓦卢)", "tv", "688" ], [ "U.S. Virgin Islands(美属维尔京群岛)", "vi", "1340" ], [ "Uganda(乌干达)", "ug", "256" ], [ "Ukraine (乌克兰)", "ua", "380" ], [ "United Arab Emirates (‫阿拉伯联合酋长国)", "ae", "971" ], [ "United Kingdom(大不列颠)", "gb", "44" ], [ "Uruguay(乌拉圭)", "uy", "598" ], [ "Uzbekistan (乌兹别克斯坦)", "uz", "998" ], [ "Vanuatu(瓦努阿图)", "vu", "678" ], [ "Vatican City (梵蒂冈城)", "va", "39", 1 ], [ "Venezuela(委内瑞拉)", "ve", "58" ], [ "Vietnam (越南)", "vn", "84" ], [ "Wallis and Futuna(瓦利斯群岛和富图纳群岛)", "wf", "681" ], [ "Yemen (‫也门)", "ye", "967" ], [ "Zambia(赞比亚)", "zm", "260" ], [ "Zimbabwe(津巴布韦)", "zw", "263" ] ];
    // loop over all of the countries above
    for (var i = 0; i < allCountries.length; i++) {
        var c = allCountries[i];
        allCountries[i] = {
            name: c[0],
            iso2: c[1],
            dialCode: c[2],
            priority: c[3] || 0,
            areaCodes: c[4] || null
        };
    }
});