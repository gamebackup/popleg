package  {
	public class PopIslandStart {
		public var island:String;
		public var scene:String;
		public var coords:Vector.<Number>;

		public function PopIslandStart(_island:String = "", _scene:String = "", x:Number = NaN, y:Number = NaN) {
			island = _island;
			scene = _scene;
			coords = new Vector.<Number>(2);
			coords[0] = x;
			coords[1] = y;
		}
	}
}