'use strict';

const vs = `#version 300 es
in vec4 a_position;
in vec2 a_texcoord;
in vec3 a_normal;

uniform vec3 u_lightWorldPosition;
uniform vec3 u_viewWorldPosition;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_world;
uniform mat4 u_textureMatrix;

out vec2 v_texcoord;
out vec4 v_projectedTexcoord;
out vec3 v_normal;

out vec3 v_surfaceToLight;
out vec3 v_surfaceToView;

void main() {
  // Multiply the position by the matrix.
  vec4 worldPosition = u_world * a_position;

  gl_Position = u_projection * u_view * worldPosition;

  // Pass the texture coord to the fragment shader.
  v_texcoord = a_texcoord;

  v_projectedTexcoord = u_textureMatrix * worldPosition;

  // orient the normals and pass to the fragment shader
  v_normal = mat3(u_world) * a_normal;

  // compute the world position of the surface
  vec3 surfaceWorldPosition = (u_world * a_position).xyz;

  // compute the vector of the surface to the light
  // and pass it to the fragment shader
  v_surfaceToLight = u_lightWorldPosition - surfaceWorldPosition;

  // compute the vector of the surface to the view/camera
  // and pass it to the fragment shader
  v_surfaceToView = u_viewWorldPosition - surfaceWorldPosition;
}
`;

const fs = `#version 300 es
precision highp float;

// Passed in from the vertex shader.
in vec2 v_texcoord;
in vec4 v_projectedTexcoord;
in vec3 v_normal;
in vec3 v_surfaceToLight;
in vec3 v_surfaceToView;

uniform vec4 u_colorMult;
uniform sampler2D u_texture;
uniform sampler2D u_projectedTexture;
uniform float u_bias;
uniform float u_shininess;
uniform vec3 u_lightDirection;
uniform float u_innerLimit;          // in dot space
uniform float u_outerLimit;          // in dot space

out vec4 outColor;

void main() {
  // because v_normal is a varying it's interpolated
  // so it will not be a unit vector. Normalizing it
  // will make it a unit vector again
  vec3 normal = normalize(v_normal);

  vec3 surfaceToLightDirection = normalize(v_surfaceToLight);
  vec3 surfaceToViewDirection = normalize(v_surfaceToView);
  vec3 halfVector = normalize(surfaceToLightDirection + surfaceToViewDirection);

  float dotFromDirection = dot(surfaceToLightDirection,
                               -u_lightDirection);
  float limitRange = u_innerLimit - u_outerLimit;
  float inLight = clamp((dotFromDirection - u_outerLimit) / limitRange, 0.0, 1.0);
  float light = inLight * dot(normal, surfaceToLightDirection);
  float specular = inLight * pow(dot(normal, halfVector), u_shininess);

  vec3 projectedTexcoord = v_projectedTexcoord.xyz / v_projectedTexcoord.w;
  float currentDepth = projectedTexcoord.z + u_bias;

  bool inRange =
      projectedTexcoord.x >= 0.0 &&
      projectedTexcoord.x <= 1.0 &&
      projectedTexcoord.y >= 0.0 &&
      projectedTexcoord.y <= 1.0;

  // the 'r' channel has the depth values
  float projectedDepth = texture(u_projectedTexture, projectedTexcoord.xy).r;
  //float shadowLight = (inRange && projectedDepth <= currentDepth) ? 0.0 : 1.0;

  float shadow = 0.0;
  ivec2 textureSize2d = textureSize(u_projectedTexture, 0);

  float textureSize = float(textureSize2d.x);
  float ftexelSize = 1.0 / textureSize;
  vec2 texelSize = vec2(ftexelSize, ftexelSize);

  float distance_blocker = projectedDepth; // (removed bias that added before, inefficient)
  float distance_receiver =  currentDepth - u_bias; // might be flipped
  float light_size = 2.0; // adjust later
  float penumbra = (distance_receiver - distance_blocker) * light_size / distance_blocker;
  // func penumbra = 0 -> 0, penumbra = inf -> 14
  // read https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf to see what to do with penumbra
  int pcfSize = int(penumbra * 30.0);
  int total_calculations = pcfSize * 2 + 1; // scales linearly
  int step_size = total_calculations / 9;
  // 9 x 9 PCF
  for(int x = -pcfSize; x <= pcfSize; x+=step_size){
    for(int y = -pcfSize; y <= pcfSize; y+=step_size){
      float pcfDepth = texture(u_projectedTexture, projectedTexcoord.xy + vec2(x,y) * texelSize).r;
      shadow += currentDepth < pcfDepth ? 1.0 : 0.0; // was currentDepth - bias, might be different logic
    }
  }
  //float total_calculations = float(pcfSize * 2 + 1) * float(pcfSize * 2 + 1);
  shadow /= float(total_calculations);

  vec4 texColor = texture(u_texture, v_texcoord) * u_colorMult;
  outColor = vec4(
      texColor.rgb * light * shadow +
      specular * shadow,
      texColor.a);
}
`;

const colorVS = `#version 300 es
in vec4 a_position;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_world;

void main() {
  // Multiply the position by the matrices.
  gl_Position = u_projection * u_view * u_world * a_position;
}
`;

const colorFS = `#version 300 es
precision highp float;

uniform vec4 u_color;

out vec4 outColor;

void main() {
  outColor = u_color;
}
`;