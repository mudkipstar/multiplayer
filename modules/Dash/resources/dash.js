(function (mw, $, shaka) {
	"use strict";
	if (!window.Promise) {
		shaka.polyfill.installAll();
	}
	if (shaka.Player.isBrowserSupported() && !mw.isDesktopSafari()) {
		$(mw).bind('EmbedPlayerUpdateMediaPlayers', function (event, mediaPlayers) {
			mw.log("Dash::Register shaka player for application/dash+xml mime type");
			var shakaPlayer = new mw.MediaPlayer('shakaPlayer', ['application/dash+xml'], 'Native');
			mediaPlayers.addPlayer(shakaPlayer);
			mw.EmbedTypes.mediaPlayers.setMIMETypePlayers('application/dash+xml', 'Native');
		});
		var dash = mw.KBasePlugin.extend({

			/** type {boolean} */
			loaded: false,

			/** type {boolean} */
			LoadShaka: false,

			/**
			 * Check is shaka is supported
			 * @returns {boolean}
			 */
			isSafeEnviornment: function () {
				return shaka.Player.isBrowserSupported() && !mw.getConfig( "EmbedPlayer.ForceNativeComponent");
			},
			/**
			 * Setup the shaka playback engine wrapper with supplied config options
			 */
			setup: function () {
				this.addBindings();
			},
			/**
			 *
			 */
			addBindings: function () {
				this.bind("SourceChange", this.isNeeded.bind(this));
				this.bind("playerReady", this.initShaka.bind(this));
				this.bind("seeking", this.onSeekBeforePlay.bind(this));
				this.bind("switchAudioTrack", this.onSwitchAudioTrack.bind(this));
				this.bind("selectClosedCaptions", this.onSwitchTextTrack.bind(this));
				this.bind("onChangeMedia", this.clean.bind(this));
			},

			/**
			 * Check if Shaka engine is required, e.g. the selected source is dash
			 */
			isNeeded: function () {
				if (this.getPlayer().mediaElement.selectedSource.mimeType === "application/dash+xml") {
					this.LoadShaka = true;
				} else {
					this.LoadShaka = false;
				}
			},

			/**
			 * Register the playback events and attach the playback engine to the video element
			 */
			initShaka: function () {
				if (this.LoadShaka && !this.loaded) {
					this.log("Init shaka");

					//Set streamerType to dash
					this.embedPlayer.streamerType = 'dash';

					this.loaded = true;

					//Disable update of video source tag, MSE uses blob urls!
					this.getPlayer().skipUpdateSource = true;
					this.overridePlayerMethods();

					this.setEmbedPlayerConfig(this.getPlayer());

					// Create a Player instance.
					var player = new shaka.Player(this.getPlayer().getPlayerElement());

					player.configure(this.getConfig("shakaConfig"));

					// Attach player to the window to make it easy to access in the JS console.
					window.player = player;
					// vtt.js override the VTTCue to wrong format for shaka, so set the original VTTCue
					window.VTTCue = this.getPlayer().getOriginalVTTCue();

					this.registerShakaEvents();

					this.bind("firstPlay", function(){
						this.unbind("seeking");
						this.loadManifest();
					}.bind(this));
				}
			},

			setEmbedPlayerConfig: function (embedPlayer) {
				//Get user configuration
				var userConfig = embedPlayer.getKalturaConfig("dash");
				//Get default config
				var dashConfig = this.getDefaultDashConfig();
				//Deep extend custom config
				$.extend(true, dashConfig, userConfig);
				embedPlayer.setKalturaConfig("dash", dashConfig);
			},

			getDefaultDashConfig: function () {
				var drmConfig = this.getDrmConfig();
				var defaultConfig = {
					shakaConfig: {
						drm: {
							servers: {
								'com.widevine.alpha': drmConfig.licenseBaseUrl + "/cenc/widevine/license?" + drmConfig.licenseData,
								'com.microsoft.playready': drmConfig.licenseBaseUrl + "/cenc/playready/license?" + drmConfig.licenseData
							}
						}
					}
				};
				return defaultConfig;
			},

			getDrmConfig: function () {
				var licenseBaseUrl = mw.getConfig('Kaltura.UdrmServerURL');
				if (!licenseBaseUrl) {
					this.log('Error:: failed to retrieve UDRM license URL ');
				}

				var licenseData = this.getPlayer().mediaElement.getLicenseUriComponent();
				var drmConfig = {
					licenseBaseUrl: licenseBaseUrl,
					licenseData: licenseData
				};
				return drmConfig;
			},

			registerShakaEvents: function(){
				player.addEventListener('error', this.onErrorEvent.bind(this));
				player.addEventListener('adaptation', this.onAdaptation.bind(this));
			},

			loadManifest: function () {
				var _this = this;
				var selectedSource = this.getPlayer().getSrc();
				this.getPlayer().resolveSrcURL(selectedSource)
					.done(function (manifestSrc) {  // success
						selectedSource = manifestSrc;
					})
					.always(function () {  // both success or error
							// Try to load a manifest.
							player.load(selectedSource).then(function () {
								// This runs if the asynchronous load is successful.
								_this.log('The video has now been loaded!');
								_this.addTracks();
							}).catch(_this.onError.bind(_this));  // onError is executed if the asynchronous load fails.
						}
					);
			},

			addTracks: function () {
				this.addAbrFlavors();
				this.addAudioTracks();
				this.addSubtitleTracks();
				if (mw.isEdge() || mw.isIE()) {
					// Shaka handles the tracks by itself,
					// so the native player doesn't need to handle them on 'firstPlay'
					this.getPlayer().unbindHelper('firstPlay');
				}
			},

			getTracksByType: function (trackType) {
				var tracks = player.getTracks().filter(function (track) {
					return track.type == trackType;
				});
				return tracks;
			},

			addAbrFlavors: function () {
				var videoTracks = this.getTracksByType("video");
				if (videoTracks && videoTracks.length > 0) {
					var flavors = videoTracks.map(function (rep) {
						var sourceAspect = Math.round(( rep.width / rep.height ) * 100) / 100;
						// Setup a source object:
						return {
							'data-bandwidth': rep.bandwidth,
							'data-width': rep.width,
							'data-height': rep.height,
							'data-aspect': sourceAspect,
							'type': 'video/mp4',
							'data-assetid': rep.id
						};
					});
					mw.log("Dash::" + videoTracks.length + " ABR flavors were found: ", videoTracks);
					this.getPlayer().onFlavorsListChanged(flavors);
				}
			},

			addAudioTracks: function () {
				var audioTracks = this.getTracksByType("audio");
				if (audioTracks && audioTracks.length > 0) {
					var audioTrackData = {languages: []};
					$.each(audioTracks, function (index, audioTrack) {
						audioTrackData.languages.push({
							'kind': 'audioTrack',
							'language': audioTrack.language,
							'srclang': audioTrack.language,
							'label': audioTrack.language,
							'title': audioTrack.language,
							'id': audioTrack.id,
							'index': audioTrackData.languages.length
						});
					});
					mw.log("Dash::" + audioTracks.length + " audio tracks were found: ", audioTracks);
					this.onAudioTracksReceived(audioTrackData);
				}
			},

			addSubtitleTracks: function () {
				var textTracks = this.getTracksByType("text");
				if (textTracks && textTracks.length > 0) {
					var textTrackData = {languages: []};
					$.each(textTracks, function (index, subtitleTrack) {
						textTrackData.languages.push({
							'kind': 'subtitle',
							'language': subtitleTrack.language,
							'srclang': subtitleTrack.language,
							'label': subtitleTrack.language,
							'title': subtitleTrack.language,
							'id': subtitleTrack.id,
							'index': textTrackData.languages.length
						});
					});
					mw.log("Dash::" + textTracks.length + " text tracks were found: ", textTracks);
					this.onTextTracksReceived(textTrackData);
				}
			},

			onAudioTracksReceived: function (data) {
				this.getPlayer().triggerHelper('audioTracksReceived', data);
			},

			onTextTracksReceived: function (data) {
				this.getPlayer().triggerHelper('textTracksReceived', data);
			},

			/**
			 * Override player method for source switch
			 * @param source
			 */
			switchSrc: function (source) {
				if (source !== -1) {
					var selectedAbrTrack = this.getTracksByType("video").filter(function (abrTrack) {
						return abrTrack.id === source.getAssetId();
					})[0];
					if (selectedAbrTrack) {
						player.selectTrack(selectedAbrTrack, false);
						var currentBitrate = source.getBitrate();
						this.embedPlayer.currentBitrate = currentBitrate;
						this.embedPlayer.triggerHelper('bitrateChange', currentBitrate);
						this.embedPlayer.triggerHelper("sourceSwitchingStarted");
						var _this = this;
						setTimeout(function(){
							_this.embedPlayer.triggerHelper("sourceSwitchingEnd", currentBitrate);
						},1000);
						mw.log("switchSrc to ", selectedAbrTrack);
					}
				} else { // "Auto" option is selected
					player.configure({
						abr: {
							enabled: true
						}
					});
					this.log("switchSrc to Auto");
				}
			},

			/**
			 * Override player callback after changing media
			 */
			playerSwitchSource: function (src, switchCallback, doneCallback) {
				this.getPlayer().play();
				if ($.isFunction(switchCallback)) {
					switchCallback();
				}
			},

			/**
			 * Override player method for loading the video element
			 */
			load: function () {
			},

			onSwitchAudioTrack: function (event, data) {
				var selectedAudioTracks = this.getTracksByType("audio")[data.index];
				player.configure({
					preferredAudioLanguage: selectedAudioTracks.language
				});
				mw.log("onSwitchAudioTrack switch to ", selectedAudioTracks);
			},

			onSwitchTextTrack: function (event, data) {
				if (data === "Off") {
					player.setTextTrackVisibility(false);
					this.log("onSwitchTextTrack disable subtitles");
				} else {
					player.configure({
						preferredTextLanguage: data
					});
					this.log("onSwitchTextTrack switch to " + data);
				}
			},

			onSeekBeforePlay: function(){
				this.unbind("seeking");
				this.unbind("firstPlay");
				this.loadManifest();
			},


			onErrorEvent: function (event) {
				// Extract the shaka.util.Error object from the event.
				this.onError(event.detail);
			},

			/**
			 * Error handler
			 * @param event
			 * @param data
			 */
			onError: function (event, data) {
				var errorData = data ? data.type + ", " + data.details : event;
				mw.log("Dash: " , errorData);
			},

			/**
			 * Clean method
			 */
			clean: function () {
				if (this.LoadShaka && this.loaded) {
					this.log("Clean");
					this.LoadShaka = false;
					this.loaded = false;
					player.destroy();
					this.restorePlayerMethods();
				}
			},

			onAdaptation: function(){
				var selectedAbrTrack = this.getTracksByType("video").filter(function (abrTrack) {
					return abrTrack.active;
				})[0];
				if(selectedAbrTrack){
					var currentBitrate = selectedAbrTrack.bandwidth / 1024;
					this.embedPlayer.currentBitrate = currentBitrate;
					if(this.currentBitrate !== currentBitrate){
						this.currentBitrate = currentBitrate;
						this.embedPlayer.triggerHelper('bitrateChange', currentBitrate);
					}
				}
			},

			/**
			 * Enable override player methods for Dash playback
			 */
			overridePlayerMethods: function () {
				this.orig_switchSrc = this.getPlayer().switchSrc;
				this.orig_playerSwitchSource = this.getPlayer().playerSwitchSource;
				this.orig_load = this.getPlayer().load;
				this.getPlayer().switchSrc = this.switchSrc.bind(this);
				this.getPlayer().playerSwitchSource = this.playerSwitchSource.bind(this);
				this.getPlayer().load = this.load.bind(this);
			},
			/**
			 * Disable override player methods for Dash playback
			 */
			restorePlayerMethods: function () {
				this.getPlayer().switchSrc = this.orig_switchSrc;
				this.getPlayer().playerSwitchSource = this.orig_playerSwitchSource;
				this.getPlayer().load = this.orig_load;
			}

		});

		mw.PluginManager.add('Dash', dash);

		var playerConfig = window.kalturaIframePackageData.playerConfig;
		if (playerConfig && playerConfig.plugins && !playerConfig.plugins["dash"]) {
			playerConfig.plugins["dash"] = {
				plugin : true
			};
			mw.setConfig('KalturaSupport.PlayerConfig', playerConfig);
		}
	}
})
(window.mw, window.jQuery, window.shaka);