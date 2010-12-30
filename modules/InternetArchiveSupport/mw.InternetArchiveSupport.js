
mw.IA = 
{
  css:function(str)
  {
    var obj = document.createElement('style');
    obj.setAttribute('type', 'text/css');
    if (obj.styleSheet)
      obj.styleSheet.cssText = str; //MSIE
    else
      obj.appendChild(document.createTextNode(str)); // other browsers
    
    var headobj = document.getElementsByTagName("head")[0];
    headobj.appendChild(obj);
  },

  // try to parse the identifier from the video and make the lower right icon
  // then go to the item's /details/ page
  detailsLink:function()
  {
    return (typeof(location.pathname)!='undefined'  &&
            location.pathname.length>0  &&
            location.pathname.match(/^\/details\//) ?
            '/details/'+location.pathname.replace(/^\/details\/([^\/]+).*$/, '$1')
            : '');
  },

  embedUrl:function()
  {
    return ('http://www.archive.org/embed/' +
            mw.IA.detailsLink().replace(/\/details\//,''));
  },



playingClipNumMW:0,



// Set up so that:
//   - when "click to play" clicked, resize video window and playlist
//   - we advance to the next clip (when 2+ present)
newEmbedPlayerMW:function(arg)
{
  var player = $('#mwplayer');
  if (!player)
    return;

  mw.log('newEmbedPlayerMW()');
  player.bind('ended', mw.IA.onDoneMW);
  player.unbind('play').bind('play', mw.IA.firstplayMW);
},

resizeMW:function()
{
  var player = $('#mwplayer');
  
  $('#flowplayerdiv')[0].style.width  = IAPlay.FLASH_WIDTH;
  $('#flowplayerdiv')[0].style.height = IAPlay.VIDEO_HEIGHT;
  
  $('#flowplayerplaylist')[0].style.width  = IAPlay.FLASH_WIDTH;
  
  var jplay = player[0];
  IAD.log('IA ' + jplay.getWidth() + 'x' + jplay.getHeight());
  
  jplay.resizePlayer({'width':  IAPlay.FLASH_WIDTH,
        'height': IAPlay.VIDEO_HEIGHT},true);
},

firstplayMW:function()
{
  if (typeof(mw.IA.MWsetup)!='undefined')
    return;
  mw.IA.MWsetup = true;

  mw.log('firstplayMW()');
  mw.IA.resizeMW();
},


playClipMW:function(idx, id, mp4, ogv)
{
  mw.IA.playingClipNumMW = idx;
  mw.log('IAplay: '+mp4+'('+idx+')');

  // set things up so we can update the "playing triangle"
  IAPlay.flowplayerplaylist = $('#flowplayerplaylist')[0];
  IAPlay.indicateIsPlaying(idx);

  mw.ready(function(){

      var player = $('#mwplayer'); // <div id="mwplayer"><video ...></div>
      if (!player)
        return;
      
      player.embedPlayer(
        { 'autoplay' : true, 'autoPlay' : true,
            'sources' : [
              { 'src' : '/download/'+id+'/'+mp4 },
              { 'src' : '/download/'+id+'/'+ogv }
              ]
            }
        );
    });

  return false;
},


onDoneMW:function(event, onDoneActionObject )
{
  mw.IA.playingClipNumMW++;
  
  var plist = $('#flowplayerplaylist')[0].getElementsByTagName('tr');
  mw.log(plist);
  var row=plist[mw.IA.playingClipNumMW];
  if (typeof(row)=='undefined')
    return;
  
  var js=row.getAttribute('onClick');
  //alert('HIYA xxxx tracey '+mw.IA.playingClipNumMW + ' ==> ' + js);
  
  var parts=js.split("'");
  var id=parts[1];
  var mp4=parts[3];
  var ogv=parts[5];
  
  mw.IA.playClipMW(mw.IA.playingClipNumMW, id, mp4, ogv);
},


  
  

  setup:function()
  {
    mw.IA.css(".archive-icon {\n\
background-image:url('http://www.archive.org/images/logo-mw.png') !important;\n\
background-repeat:no-repeat;\n\
display: block;\n\
height: 12px;\n\
width: 12px;\n\
margin-top: -6px !important;\n\
margin-left: 3px !important;\n\
}\n\
\n\
div.control-bar { -moz-border-radius:6px; -webkit-border-radius:6px; -khtml-border-radius:6px; border-radius:6px; }\n\
\n\
");


    var det = mw.IA.detailsLink();
    
    if (det == ''  &&  typeof(document.getElementsByTagName)!='undefined')
    {
      var els = document.getElementsByTagName('object');
      if (els  &&  els.length)
      {
        var i=0;
        for (i=0; i < els.length; i++)
        {
          var el = els[i];
          if (typeof(el.data)!='undefined')
          {
            var mat = el.data.match(/\.archive.org\/download\/([^\/]+)/);
            if (typeof(mat)!='undefined'  &&  mat  &&  mat.length>1)
            {
              det = '/details/' + mat[1]; //xxx not working yet for embed codes!!
              break;
            }
          }
        }
      }
    }
    
    
    //var mods = mw.getConfig('enabledModules');
    //mods.push('InternetArchiveSupport');


    mw.setConfig( {		
        // We want our video player to attribute something...
        "EmbedPlayer.AttributionButton" : true,
        
        // 'enabledModules' : mods,
        
        //"EmbedPlayer.NativeControlsMobileSafari" : true, //xxx
        
        // Our attribution button
        'EmbedPlayer.AttributionButton' : {
          'title' : 'Internet Archive',
          'href' : 'http://www.archive.org'+det,
          'class' : 'archive-icon'
        }
      });
    

    //alert(mw.getConfig('enabledModules'));
    //mw.load('mw.InternetArchiveSupport', function() { alert('loada'); });
  }
}
  

mw.IA.setup();
