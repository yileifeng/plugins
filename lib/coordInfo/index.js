"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var html_assets_1 = require("./html-assets");
var CoordInfo = /** @class */ (function () {
    function CoordInfo() {
        this.urls = {
            nts: 'https://geogratis.gc.ca/services/delimitation/en/nts?',
            utm: 'https://geogratis.gc.ca/services/delimitation/en/utmzone?',
            alti: 'https://geogratis.gc.ca/services/elevation/cdem/altitude?',
            decli: 'http://geomag.nrcan.gc.ca/service/tools/magnetic/calculator/?'
        };
    }
    CoordInfo.prototype.init = function (api) {
        this.api = api;
        this.button = this.api.mapI.addPluginButton(CoordInfo.prototype.translations[this._RV.getCurrentLang()].coordButtonLabel, this.onMenuItemClick());
    };
    /**
     * Returns a function to be executed when the map is clicked.
     *
     * @function  onMenuItemClick
     * @return  {Function}    Callback to be executed when map is clicked
     */
    CoordInfo.prototype.onMenuItemClick = function () {
        var _this = this;
        var identifySetting;
        return function () {
            _this._RV.toggleSideNav('close');
            // only set event if not already created
            if (typeof _this.handler === 'undefined') {
                _this.handler = _this.api.click.subscribe(function (clickEvent) { return _this.clickHandler(clickEvent); });
                // set cursor
                _this._RV.setMapCursor('crosshair');
                // set active (checked) in the side menu
                _this.button.isActive = true;
                // store current identify value and then disable in viewer
                identifySetting = _this.api.layers.identifyMode;
                _this.api.layers.identifyMode = 'none';
            }
            else {
                // remove the click handler and set the cursor
                _this.handler.unsubscribe();
                _this.handler = undefined;
                _this._RV.setMapCursor('');
                // set inactive (unchecked) in the side menu
                _this.button.isActive = false;
                // reset identify value to stored value
                _this.api.layers.identifyMode = identifySetting;
            }
        };
    };
    /**
     * Manage callback when the map is clicked.
     *
     * @function  clickHandler
     * @param  {Object}  clickEvent the map click event
     */
    CoordInfo.prototype.clickHandler = function (clickEvent) {
        var _this = this;
        // get current language
        var lang = this._RV.getCurrentLang();
        // get point in lat/long
        var pt = clickEvent.xy; //this._RV.projectGeometry(clickEvent.mapPoint, 4326);
        pt.spatialReference = 4326;
        // get point in dms
        var dms = this._RV.convertDDToDMS(pt.y, pt.x);
        // todays date for magnetic declination
        var date = new Date().toISOString().substr(0, 10);
        // get info from services (nts, utm zone, altimetry and magnetic declination)
        var promises = [];
        promises.push(new Promise(function (resolve) {
            $.ajax({
                url: _this.urls.nts,
                cache: false,
                data: { bbox: pt.x + "," + pt.y + "," + pt.x + "," + pt.y },
                dataType: 'jsonp',
                success: function (data) { return resolve(_this.parseNTS(data.features)); }
            });
        }));
        promises.push(new Promise(function (resolve) {
            $.ajax({
                url: _this.urls.utm,
                cache: false,
                data: { bbox: pt.x + "," + pt.y + "," + pt.x + "," + pt.y },
                dataType: 'jsonp',
                success: function (data) { return resolve(_this.parseUtm(data.features, pt)); }
            });
        }));
        promises.push(new Promise(function (resolve) {
            $.ajax({
                url: _this.urls.alti,
                cache: false,
                data: { lat: pt.y, lon: pt.x },
                dataType: 'jsonp',
                success: function (data) { return resolve(data.altitude !== null ? data.altitude : 0); }
            });
        }));
        // Magnetic declination service is only available in http
        if (window.location.protocol === 'http:') {
            promises.push(new Promise(function (resolve) {
                $.ajax({
                    url: _this.urls.decli,
                    cache: true,
                    data: { latitude: pt.y, longitude: pt.x, date: date, format: 'json' },
                    dataType: 'jsonp',
                    success: function (data) { return resolve(_this.parseDecli(data, lang)); },
                    error: function () {
                        resolve(undefined);
                    }
                });
            }));
        }
        // wait for all promises to resolve then show info
        Promise.all(promises).then(function (values) {
            _this.generateOutput(values, pt, dms, date);
        });
    };
    /**
     * Generate dialog window content.
     *
     * @function  generateOutput
     * @param  {Array}  val the array of response from the promises
     * @param {Object}  pt  the point in decimal degree
     * @param {Object}  dms the point in degree minute second
     * @param {String}  date the today's date
     */
    CoordInfo.prototype.generateOutput = function (val, pt, dms, date) {
        var output = html_assets_1.template
            // coord
            .replace(/{pt.y}/, pt.y.toFixed(6))
            .replace(/{pt.x}/, pt.x.toFixed(6))
            .replace(/{dms.y}/, dms.y)
            .replace(/{dms.x}/, dms.x)
            // utm
            .replace(/{zone}/, val[1].zone)
            .replace(/{outPt.x}/, val[1].outPt.x)
            .replace(/{outPt.y}/, val[1].outPt.y)
            // nts
            .replace(/{nts250}/, val[0].nts250)
            .replace(/{nts50}/, val[0].nts50)
            // alti
            .replace(/{elevation}/, val[2]);
        // magnetic declination service is only available in http
        // the server seems to also have a tendency to throw 500s
        if (val[3]) {
            var magOutput = html_assets_1.magSection
                .replace(/{date}/, date)
                .replace(/{magnetic}/, val[3].magnetic)
                .replace(/{annChange}/, val[3].annChange)
                .replace(/{compass}/, val[3].compass);
            output = output.replace(/{magSection}/, magOutput);
        }
        else {
            output = output.replace(/{magSection}/, '');
        }
        if (!this.panel) {
            this.panel = this.api.newPanel('coord-info');
            this.panel.keepAlive = true;
            this.panel.element.css({
                bottom: '0em',
                width: '400px'
            });
            this.panel.element.addClass('mobile-fullscreen');
            var closeBtn = this.panel.header.closeButton;
            this.panel.header.title = "{{ 'plugins.coordInfo.coordButtonLabel' | translate }}";
        }
        else {
            this.panel.close();
        }
        this.panel.body = output;
        this.panel.open();
    };
    /**
     * Parse NTS answer from the service to generate content.
     *
     * @function  parseNTS
     * @param  {Object}  nts the answer from the service
     * @return {Object}   the nts information (nts250 {String} 250k nts name, nts50 {String} 50k nts name)
     */
    CoordInfo.prototype.parseNTS = function (nts) {
        // set 250k
        var nts250 = nts.length > 0 ? nts[0].properties.identifier + "-" + nts[0].properties.name : '';
        // set 50k
        var nts50 = nts.length > 1 ? nts[1].properties.identifier + "-" + nts[1].properties.name : '';
        return { nts250: nts250, nts50: nts50 };
    };
    /**
     * Parse UTM answer from the service to generate content.
     *
     * @function  parseUtm
     * @param  {Object}  utm the answer from the service
     * @param  {Object}  pt the point to reproject
     * @return {Object}   the utm information (zone {String} utm zone, x {Number} Easting, y {Number} Northing)
     */
    CoordInfo.prototype.parseUtm = function (utm, pt) {
        if (utm.length === 0) {
            return { zone: 'Error', outPt: { x: '-', y: '-' } };
        }
        // set zone
        var zone = utm[0].properties.identifier;
        if (zone < 10) {
            zone = "0" + zone;
        }
        // set the UTM easting/northing information using a geometry service
        var outPt = this._RV.projectGeometry(pt, parseInt('326' + zone));
        return { zone: zone, outPt: { x: outPt.x, y: outPt.y } };
    };
    /**
     * Parse declination answer from the service to generate content.
     *
     * @function  parseDecli
     * @param  {Object}  decli the answer from the service
     * @param  {String}  lang the current language
     * @return {Object}   the declination information (magnetic {String} magnetic declination, annChange {Number} Annual change, compass {String} Compass information)
     */
    CoordInfo.prototype.parseDecli = function (decli, lang) {
        /* jshint -W106 */
        /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
        var magnetic = decli.components.D !== null ? "" + decli.components.D + String.fromCharCode(176) : '---';
        var annChange = decli.annual_change.dD !== null ? decli.annual_change.dD : '---';
        var compass = decli.compass !== 'useless' ? '' : CoordInfo.prototype.translations[lang].plugin.coordInfo.magCompassOut;
        return { magnetic: magnetic, annChange: annChange, compass: compass };
    };
    return CoordInfo;
}());
CoordInfo.prototype.translations = {
    'en-CA': {
        coordButtonLabel: 'Coords Info',
        title: 'Map location information',
        coordSection: 'Geographic Coordinates',
        coordLat: 'Latitude: ',
        coordLong: 'Longitude: ',
        coordDecimal: 'Degrees Decimal: ',
        coordDMS: 'Degrees Minutes Seconds (DMS): ',
        utmSection: 'UTM Coordinates',
        utmZone: 'Zone: ',
        utmEast: 'Easting: ',
        utmNorth: 'Northing: ',
        ntsSection: 'NTS Mapsheet',
        altiSection: 'Elevation',
        magSection: 'Magnetic declination',
        magDate: 'Date: ',
        magDecli: 'Magnetic declination (DD): ',
        magChange: 'Annual change (minutes/year): ',
        magDecliOut: '-WARNING- Out of scope.',
        magCompassOut: '-WARNING- Compass erratic for this coordinate.'
    },
    'fr-CA': {
        coordButtonLabel: 'Info coords',
        title: 'Information de localisation sur la carte',
        coordSection: 'Coordonnées géographiques',
        coordLat: 'Latitude : ',
        coordLong: 'Longitude : ',
        coordDecimal: 'Degrés décimaux : ',
        coordDMS: 'Degrés minutes secondes (DMS) : ',
        utmSection: 'Coordonnées UTM',
        utmZone: 'Zone : ',
        utmEast: 'Abscisse : ',
        utmNorth: 'Ordonnée : ',
        ntsSection: 'Carte du SNRC',
        altiSection: 'Élévation',
        magSection: 'Déclinaison magnétique',
        magDate: 'Date : ',
        magDecli: 'Déclinaison magnétique (DD) : ',
        magChange: 'Changement annuel (minutes/année) : ',
        magDecliOut: '-ATTENTION- Hors de portée.',
        magCompassOut: '-ATTENTION- Boussole peu fiable pour cette coordonnée.'
    }
};
window.coordInfo = CoordInfo;