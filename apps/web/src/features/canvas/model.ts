export type ScenePoint = {
  x: number;
  y: number;
};

export type RectangleShape = {
  id: string;
  type: "rectangle";
  position: ScenePoint;
  width: number;
  height: number;
  fill: string;
};

export type CircleShape = {
  id: string;
  type: "circle";
  center: ScenePoint;
  radius: number;
  fill: string;
};

export type Shape = RectangleShape | CircleShape;
export type Scene = readonly Shape[];

export type Viewport = {
  origin: ScenePoint;
  zoom: number;
};
