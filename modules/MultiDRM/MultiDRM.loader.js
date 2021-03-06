/**
 * MultiDRM loader
 */
( function( mw, $ ) {
	"use strict";
	function isMseSupported(){
		return (window['MediaSource'] || window['WebKitMediaSource']) && !mw.isFirefox() && !mw.isMobileChrome();
	}

	//Load 3rd party plugins if DRM sources are available
	mw.addKalturaConfCheck( function( embedPlayer, callback ){
		//For native callout on mobile browsers let the flow continue to native APP and decide if DRM is enbaled and supported in native SDK
		if (embedPlayer.isPluginEnabled("nativeCallout") && !mw.isNativeApp()){
			callback();
		}
		else if( embedPlayer.isPluginEnabled( 'multiDrm' )) {
			var drmConfig = setEmbedPlayerConfig(embedPlayer);
			//Check if we can play via MSE or via fallback silverlight when forceDASH is set to true or in native App
			if (isMseSupported() || (drmConfig.forceDASH && mw.supportSilverlight()) || mw.isNativeApp()) {
				mw.log("Media Source Extensions supported on this browser");
				//If both FPS certificate is available and FPS is supported then
				//use hls on native html5 video tag and FPS plugin will handle DRM flow
				//Else register the DRM playback engnie and let it handle DRM flow
				var cert = getFpsCertificate(embedPlayer);
				var useFPS = (cert !== null && cert !== "" && mw.isDesktopSafari());
				if (!useFPS){
					registerDashPlayer();
				}
				//Get multiDRM supported sources
				var allSources = embedPlayer.getSources();
				var drmSources = getMultiDrmSupportedSources(allSources);
				//If DRM is required then set the available source to be only the DRM source
				if (embedPlayer.isDrmRequired()) {
					setDrmSources(drmSources, embedPlayer);
				}
				//If there are supported medias load the playback library, unless in native SDK - let native SDK handle sources
				if ( hasDrmSources(drmSources)) {
					mw.log("Media sources found");
					if (mw.isNativeApp()){
						mw.log("Loading SDK player");
						callback();
					}
					if (useFPS){
						mw.log("Loading HLS FPS player");
						loadHlsFpsHandler().then(function(){
							mw.fps = new mw.FPS(embedPlayer, function(){}, "FPS");
							callback();
						});
					} else {
						mw.log("Loading DASH player");
						loadDashCencHandler(embedPlayer).then(callback, function(){
							unregisterDashPlayer();
							callback();
						});
					}
				} else {
					mw.log("No media sources found, not loading DASH player");
					callback();
				}
			} else {
				mw.log("Media Source Extensions not supported on this browser");
				if (embedPlayer.isDrmRequired() && !mw.supportSilverlight()) {
					//If DRM is required and we can't play DASH medias and also silverlight is not supported (give SS playready a chance to play)
					// then remove all medias so we get DRM error when trying to choose playback engine
					embedPlayer.emptySources();
				}
				callback();
			}
		} else {
			//If plugin is not enabled but DRM is required then remove all sources to prevent playback
			if (embedPlayer.isDrmRequired()){
				embedPlayer.emptySources();
			}
			callback();
		}
	});

	function loadHlsFpsHandler(){
		var deferred = $.Deferred();
		mw.load( ['mw.FPS'], function() {
			deferred.resolve();
		} );
		return deferred;
	}

	function loadDashCencHandler(embedPlayer){
		var deferred = $.Deferred();
		var clDashPlayerUrl = embedPlayer.getKalturaConfig("multiDrm", "clDashPlayerUrl") || mw.getMwEmbedPath() + "node_modules/mwEmbed-Dash-Everywhere/video.js";
		var dashJsUrl = embedPlayer.getKalturaConfig("multiDrm", "dashJsUrl") || mw.getMwEmbedPath() + "node_modules/mwEmbed-Dash-Everywhere/cldasheverywhere.min.js";
		if (clDashPlayerUrl && dashJsUrl) {
			$.ajax({
					url: clDashPlayerUrl,
					cache: true,
					dataType: "script"
				})
				.then(
					function () {
						return $.ajax({
							url: dashJsUrl,
							cache: true,
							dataType: "script"
						});
					}
				)
				.done(function () {
					mw.log("DASH player loaded");
					//Set reference for DASH playback engine
					mw.dash = {
						player: videojs
					};
					setTimeout(function () {
						deferred.resolve();
					}, 0);
				})
				.fail(function () {
					mw.log("Error::Playback engine couldn't be found");
					deferred.reject();
				});

		} else {
			mw.log("Playback engine couldn't be found, not loading DASH player");
			deferred.reject();
		}
		return deferred;
	}

	function getFpsCertificate(embedPlayer){
		var cert = null;
		if (window.kWidgetSupport){
			cert = window.kWidgetSupport.getFairplayCert({contextData: embedPlayer.kalturaContextData});
		}
		return cert;
	}

	function setEmbedPlayerConfig(embedPlayer){
		//Get user configuration
		var drmUserConfig = embedPlayer.getKalturaConfig("multiDrm");
		//Get default config
		var drmConfig = getDefaultDrmConfig(embedPlayer.kpartnerid);
		//Deep extend custom config
		$.extend(true, drmConfig, drmUserConfig);
		embedPlayer.setKalturaConfig("multiDrm", drmConfig);
		return drmConfig;
	}

	function isDash(mimeType){
		return mimeType === "application/dash+xml";
	}

	function isSmoothStream(mimeType){
		return (mimeType === "video/ism" || mimeType === "video/playreadySmooth");
	}

	function isHls(mimeType){
		return mimeType === "application/vnd.apple.mpegurl";
	}

    function getMultiDrmSupportedSources(sources, enableHlsAes) {

        var drmSources = [];
        if (!mw.isNativeApp()) {
            drmSources = sources.filter(function (source) {
                return isDash(source.mimeType) ||
                    (isSmoothStream(source.mimeType) && mw.isChrome() && !mw.isMobileDevice()) ||
					(isHls(source.mimeType) && ((enableHlsAes && mw.isMobileDevice()) || mw.isDesktopSafari()));
            });
        } else {
            drmSources = sources.filter(function (source) {
                var nativeSdkDRMTypes = window.kNativeSdk && window.kNativeSdk.drmFormats;
                return $.inArray(source.mimeType, nativeSdkDRMTypes) >= 0;
            });
            
            // Additional check for iOS, to select FairPlay or WidevineClassic.
            if (kWidget.isIOS()) {
                var fpsIndex = drmSources.findIndex(function(src) {return src.mimeType === "application/vnd.apple.mpegurl"});
                var wvmIndex = drmSources.findIndex(function(src) {return src.mimeType === "video/wvm"});
                if (fpsIndex >= 0) {
                    if (drmSources[fpsIndex].fpsCertificate) {
                        // FPS is supported and configured, remove WVM
                        if (wvmIndex >= 0) {
                            drmSources.splice(wvmIndex, 1);
                            wvmIndex = -1;
                        }
                    } else {
                        // FPS is supported by the platform, but not configured in the backend -- remove it.
                        drmSources.splice(fpsIndex, 1);
                        fpsIndex = -1;
                    }
                }
            }
        }
        
        return drmSources;
    }

	function setDrmSources(drmSources, embedPlayer){
		embedPlayer.kalturaFlavors = drmSources;
		embedPlayer.replaceSources(drmSources);
	}

	function hasDrmSources(drmSources){
		return drmSources.length > 0;
	}

	function registerDashPlayer(){
		// Add multidrm player:
		$( mw ).bind( 'EmbedPlayerUpdateMediaPlayers' , function ( event , mediaPlayers ) {
			mw.log("Register DASH player and extensions");
			var multiDRMProtocols = ['application/dash+xml'];
			//On chrome add smooth stream mimetype support
			if ( mw.isChrome() &&  !mw.isMobileDevice()) {
				multiDRMProtocols.push( "video/ism" );
				multiDRMProtocols.push( "video/playreadySmooth" );
			}
			var multiDRMPlayer = new mw.MediaPlayer( 'multidrm', multiDRMProtocols, 'MultiDRM' );
			mediaPlayers.addPlayer( multiDRMPlayer );
			// add
			$.each( multiDRMProtocols, function ( inx, mimeType ) {
				if ( mediaPlayers.defaultPlayers[mimeType] ) {
					mediaPlayers.defaultPlayers[mimeType].unshift( 'MultiDRM' );
					return true;
				}
				mediaPlayers.defaultPlayers[mimeType] = ['MultiDRM'];
			} );
		} );
	}

	function unregisterDashPlayer(){
		mw.log("Unregister DASH player mimetype extensions");
		var multiDRMProtocols = ['application/dash+xml'];
		//On chrome add smooth stream mimetype support
		if ( mw.isChrome() &&  !mw.isMobileDevice()) {
			multiDRMProtocols.push( "video/ism" );
			multiDRMProtocols.push( "video/playreadySmooth" );
		}
		var mediaPlayers = mw.EmbedTypes.getMediaPlayers();

		$.each( multiDRMProtocols, function ( inx, mimeType ) {
			mediaPlayers.removeMIMETypePlayers(mimeType, 'MultiDRM');
		} );
	}

    // Polyfills from MDN
	if (!Array.prototype.filter) {
		Array.prototype.filter = function(fun/*, thisArg*/) {
			'use strict';

			if (this === void 0 || this === null) {
				throw new TypeError();
			}

			var t = Object(this);
			var len = t.length >>> 0;
			if (typeof fun !== 'function') {
				throw new TypeError();
			}

			var res = [];
			var thisArg = arguments.length >= 2 ? arguments[1] : void 0;
			for (var i = 0; i < len; i++) {
				if (i in t) {
					var val = t[i];
					if (fun.call(thisArg, val, i, t)) {
						res.push(val);
					}
				}
			}

			return res;
		};
	}

	if (kWidget.isIOS() && !Array.prototype.findIndex) {
      Array.prototype.findIndex = function(predicate) {
        if (this === null) {
          throw new TypeError('Array.prototype.findIndex called on null or undefined');
        }
        if (typeof predicate !== 'function') {
          throw new TypeError('predicate must be a function');
        }
        var list = Object(this);
        var length = list.length >>> 0;
        var thisArg = arguments[1];
        var value;

        for (var i = 0; i < length; i++) {
          value = list[i];
          if (predicate.call(thisArg, value, i, list)) {
            return i;
          }
        }
        return -1;
      };
    }
    
	function getDefaultDrmConfig(partnerId){
		var defaultConfig = {
			"drm": "auto",
			"customData": {
				"userId": partnerId ,
				"sessionId": "castlab-session",
				"merchant": "kaltura"
			},
			"sendCustomData": false,
			"generatePSSH": false,
			"authenticationToken": null ,
			"widevineLicenseServerURL": null,
			"playReadyLicenseServerURL": null,
			"accessLicenseServerURL": null,
			"flashFile": mw.getConfig("EmbedPlayer.dashAsUrl") || mw.getMwEmbedPath() + "node_modules/mwEmbed-Dash-Everywhere/dashas/dashas.swf",
			"silverlightFile": mw.getConfig("EmbedPlayer.dashCsUrl") || mw.getMwEmbedPath() + "node_modules/mwEmbed-Dash-Everywhere/dashcs/dashcs.xap",
			"techs": ( mw.isFirefox() || mw.isDesktopSafari() )? ["dashcs"] : ["dashjs", "dashcs"] ,
			"debug": false
		};
		return defaultConfig;
	}
} )( window.mediaWiki, window.jQuery );