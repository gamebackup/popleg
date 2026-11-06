package  {
	import flash.display.MovieClip;
	import flash.external.ExternalInterface;
	import flash.net.ObjectEncoding;
	import flash.net.SharedObject;

	public class PopUtils {
		public static const LSO_USER:String = "Char";
		public static const LSO_FIELD_READY:String = "flashpointReady";

		public static const SCENE_X:String = "xPos";
		public static const SCENE_Y:String = "yPos";

		private var _islandParam:String;
		private var _sceneParam:String;
		private var _userLSO:SharedObject;

		public function PopUtils(parameters:Object) {
			_islandParam = parameters.island;
			_sceneParam = parameters.desc;
			_userLSO = PopUtils.getLSO(PopUtils.LSO_USER);
		}

		public function getSceneCoords(scene:String) : Vector.<Number> {
			const coords:Vector.<Number> = new Vector.<Number>(2);

			if(_userLSO) {
				coords[0] = Number(_userLSO.data[scene + SCENE_X]);
				coords[1] = Number(_userLSO.data[scene + SCENE_Y]);
			} else
				coords[0] = coords[1] = NaN;

			return coords;
		}

		public function setSceneCoords(scene:String, coords:Vector.<Number>) : void {
			if(coords.length === 2 && _userLSO) {
				_userLSO.data[scene + SCENE_X] = coords[0];
				_userLSO.data[scene + SCENE_Y] = coords[1];
			}
		}

		public function removeSceneCoords(scene:String) : void {
			if(_userLSO) {
				delete _userLSO.data[scene + SCENE_X];
				delete _userLSO.data[scene + SCENE_Y];
			}
		}

		public function loadSceneWithCoords(island:String, scene:String, coords:Vector.<Number>) : void {
			setSceneCoords(scene, coords);
			save();
			PopUtils.loadScene(island, scene);
		}

		public function unlockMembership() : void {
			if(_userLSO)
				_userLSO.data.mem_status = "active-norenew";
		}

		public function save() : void {
			if(_userLSO)
				_userLSO.flush();
		}

		public function get userLSO() : SharedObject {
			return _userLSO;
		}

		public function get islandParam() : String {
			return _islandParam;
		}

		public function get sceneParam() : String {
			return _sceneParam;
		}

		public static function getLSO(name:String) : SharedObject {
			try {
				const lso:SharedObject = SharedObject.getLocal(name, "/");
				lso.objectEncoding = ObjectEncoding.AMF0;
				return lso;
			} catch(err:*) {
				trace(err);
			}

			return null;
		}

		public static function loadScene(island:String, scene:String) : void {
			send("flashpointLoad", island, scene);
		}

		public static function handleError(recoverable:Boolean) : void {
			trace("Encountered an error! Is it recoverable? " + recoverable);
			send("flashpointError", recoverable);
		}

		public static function send(funcName:String, ...params:*) : * {
			if(canSend) {
				params.unshift(funcName);
				return ExternalInterface.call.apply(null, params);
			}
		}

		public static function get canSend() : Boolean {
			return ExternalInterface.available;
		}
	}
}